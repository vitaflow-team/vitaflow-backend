/**
 * Integration tests for PRD `notifications` (task_01, backend).
 *
 * Runs the real NotificationsController/NotificationsService/repositories/
 * AuthGuard and the app's global ValidationPipe against an isolated
 * database. Only `MailService` is mocked at the module boundary (TechSpec
 * § Testing Approach) — no automated test calls a real SMTP server.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { MailService } from '@/mail/mail.service';
import { NotificationsController } from '@/notifications/notifications.controller';
import { NotificationsService } from '@/notifications/notifications.service';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(30_000);

const RUN_TAG = `notif-${Date.now()}`;

describe('Notifications integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let user: Users;
  let otherUser: Users;
  const sendNotificationEmail = jest.fn();
  const jwtSecret = 'notifications-integration-jwt-secret';

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = jwtSecret;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: jwtSecret })],
      controllers: [NotificationsController],
      providers: [
        PrismaService,
        UserRepository,
        NotificationsRepository,
        NotificationsService,
        AuthGuard,
        { provide: MailService, useValue: { sendNotificationEmail } },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);

    user = await createUser('primary');
    otherUser = await createUser('other');
  });

  beforeEach(() => {
    sendNotificationEmail.mockReset();
  });

  afterEach(async () => {
    await prisma.notification.deleteMany({
      where: { userId: { in: [user.id, otherUser.id] } },
    });
    await prisma.notificationPreference.deleteMany({
      where: { userId: { in: [user.id, otherUser.id] } },
    });
  });

  afterAll(async () => {
    await prisma.users.deleteMany({
      where: { id: { in: [user.id, otherUser.id] } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  async function createUser(
    label: string,
    extra: Partial<Prisma.UsersUncheckedCreateInput> = {},
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Notifications ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        ...extra,
      },
    });
  }

  async function bearerFor(target: Users): Promise<string> {
    const token = await jwtService.signAsync({
      id: target.id,
      email: target.email,
    });
    return `Bearer ${token}`;
  }

  async function seedNotification(
    overrides: Partial<Prisma.NotificationUncheckedCreateInput> = {},
  ) {
    return await prisma.notification.create({
      data: {
        userId: user.id,
        category: 'BILLING',
        message: `${RUN_TAG} notification`,
        ...overrides,
      },
    });
  }

  it('IT-001 lists notifications newest-first and reports the correct unread count', async () => {
    const auth = await bearerFor(user);
    await seedNotification({
      message: 'first',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    await seedNotification({
      message: 'second',
      createdAt: new Date('2026-09-15T00:00:00.000Z'),
    });
    await seedNotification({
      message: 'third (read)',
      createdAt: new Date('2026-09-20T00:00:00.000Z'),
      readAt: new Date('2026-09-21T00:00:00.000Z'),
    });

    const list = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', auth);
    expect(list.status).toBe(200);
    expect(list.body.map((n: { message: string }) => n.message)).toEqual([
      'third (read)',
      'second',
      'first',
    ]);

    const unread = await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .set('Authorization', auth);
    expect(unread.body.count).toBe(2);
  });

  it("IT-002 refuses marking another user's notification, succeeds on the owner's own", async () => {
    const auth = await bearerFor(user);
    const otherAuth = await bearerFor(otherUser);
    const notification = await seedNotification();

    const refused = await request(app.getHttpServer())
      .post(`/notifications/${notification.id}/read`)
      .set('Authorization', otherAuth);
    expect(refused.status).toBe(404);

    const before = await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .set('Authorization', auth);
    expect(before.body.count).toBe(1);

    const allowed = await request(app.getHttpServer())
      .post(`/notifications/${notification.id}/read`)
      .set('Authorization', auth);
    expect(allowed.status).toBe(204);

    const after = await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .set('Authorization', auth);
    expect(after.body.count).toBe(0);
  });

  it('IT-004 persists and reflects a preference change', async () => {
    const auth = await bearerFor(user);

    const before = await request(app.getHttpServer())
      .get('/notifications/preferences')
      .set('Authorization', auth);
    expect(before.body.MESSAGES).toBe(true);

    const patched = await request(app.getHttpServer())
      .patch('/notifications/preferences/MESSAGES')
      .set('Authorization', auth)
      .send({ enabled: false });
    expect(patched.status).toBe(204);

    const after = await request(app.getHttpServer())
      .get('/notifications/preferences')
      .set('Authorization', auth);
    expect(after.body.MESSAGES).toBe(false);
    expect(after.body.PRODUCT_NEWS).toBe(false);
    expect(after.body.BILLING).toBe(true);
  });
});
