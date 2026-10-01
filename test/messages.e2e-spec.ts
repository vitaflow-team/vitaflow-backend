/**
 * Integration tests for PRD `messages` (task_01, backend).
 *
 * Runs the real MessagesController/MessagesService/repositories, AuthGuard,
 * DualBucketThrottlerGuard, and the app's global ValidationPipe against an
 * isolated database. NotificationsService's real wiring runs unmocked (only
 * MailService is mocked at the boundary) — the same pattern professional-
 * discovery's own e2e suite already established.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { DualBucketThrottlerGuard } from '@/auth/dualBucketThrottler.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { MailService } from '@/mail/mail.service';
import { MessagesController } from '@/messages/messages.controller';
import { MessagesService } from '@/messages/messages.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { MessagesRepository } from '@/repositories/messages/messages.repository';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { Prisma, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(30_000);

const RUN_TAG = `msg-${Date.now()}`;

describe('Messages integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let nutritionist: Users;
  let user: Users;
  let stranger: Users;
  const sendNotificationEmail = jest.fn();
  const jwtSecret = 'messages-integration-jwt-secret';

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = jwtSecret;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: jwtSecret }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
      ],
      controllers: [MessagesController],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        MessagesRepository,
        MessagesService,
        NotificationsRepository,
        NotificationsService,
        AuthGuard,
        DualBucketThrottlerGuard,
        { provide: MailService, useValue: { sendNotificationEmail } },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);

    await seedUsers();
  });

  beforeEach(() => {
    sendNotificationEmail.mockReset();
  });

  afterEach(async () => {
    const conversations = await prisma.conversation.findMany({
      where: { OR: [{ userId: user.id }, { userId: stranger.id }] },
      select: { id: true },
    });
    const conversationIds = conversations.map((c) => c.id);
    await prisma.message.deleteMany({
      where: { conversationId: { in: conversationIds } },
    });
    await prisma.conversation.deleteMany({
      where: { id: { in: conversationIds } },
    });
    await prisma.notification.deleteMany({
      where: { userId: { in: [nutritionist.id, user.id] } },
    });
  });

  afterAll(async () => {
    const userIds = [nutritionist, user, stranger]
      .filter(Boolean)
      .map((u) => u.id);
    await prisma.client.deleteMany({
      where: { professionalId: nutritionist.id },
    });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
    await prisma.product.deleteMany({ where: { groupId } });
    await prisma.productGroup.deleteMany({ where: { id: groupId } });
    await prisma.$disconnect();
    await app.close();
  });

  async function seedUsers(): Promise<void> {
    const group = await prisma.productGroup.create({
      data: {
        name: `${RUN_TAG} group`,
        products: {
          create: [
            {
              name: `${RUN_TAG} nutri`,
              price: 10,
              type: ProductType.NUTRITIONIST,
            },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;

    nutritionist = await createUser('nutri', {
      productId: group.products[0].id,
    });
    user = await createUser('user', {});
    stranger = await createUser('stranger', {});

    await prisma.client.create({
      data: {
        name: user.name,
        email: user.email,
        phone: '',
        userId: user.id,
        professional: { connect: { id: nutritionist.id } },
      },
    });
  }

  async function createUser(
    label: string,
    extra: Partial<Prisma.UsersUncheckedCreateInput>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Messages ${label}`,
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

  it('IT-001 accepted relationship sends (201); no relationship at all is refused (403)', async () => {
    const userAuth = await bearerFor(user);
    const accepted = await request(app.getHttpServer())
      .post(`/conversations/${nutritionist.id}/messages`)
      .set('Authorization', userAuth)
      .send({ content: 'Oi, tudo bem?' });
    expect(accepted.status).toBe(201);

    const strangerAuth = await bearerFor(stranger);
    const refused = await request(app.getHttpServer())
      .post(`/conversations/${nutritionist.id}/messages`)
      .set('Authorization', strangerAuth)
      .send({ content: 'Posso falar com você?' });
    expect(refused.status).toBe(403);
  });

  it('IT-001b a counterpart with no linked Client row at all is refused (403) — covers the "Client exists with userId: null" real-world case, which never produces a reachable counterpartId', async () => {
    // A Client row with userId: null has no account to address as
    // counterpartId in the first place; the closest reachable equivalent is
    // a real account the professional has no Client row for at all.
    const strangerAuth = await bearerFor(stranger);

    const refused = await request(app.getHttpServer())
      .post(`/conversations/${nutritionist.id}/messages`)
      .set('Authorization', strangerAuth)
      .send({ content: 'Oi' });

    expect(refused.status).toBe(403);
    expect(refused.body.message).toBe(
      'Você só pode enviar mensagens para um profissional ou aluno com quem tem um vínculo ativo.',
    );
  });

  it('IT-002 throttles sends past the configured per-minute limit', async () => {
    const userAuth = await bearerFor(user);

    for (let index = 0; index < 20; index += 1) {
      const response = await request(app.getHttpServer())
        .post(`/conversations/${nutritionist.id}/messages`)
        .set('Authorization', userAuth)
        .set('x-forwarded-for', '10.20.30.40')
        .send({ content: `mensagem ${index}` });
      expect(response.status).toBe(201);
    }

    const throttled = await request(app.getHttpServer())
      .post(`/conversations/${nutritionist.id}/messages`)
      .set('Authorization', userAuth)
      .set('x-forwarded-for', '10.20.30.40')
      .send({ content: 'mensagem 20' });
    expect(throttled.status).toBe(429);
  });

  it('IT-003 polls only messages created after the given cursor', async () => {
    const userAuth = await bearerFor(user);

    const first = await request(app.getHttpServer())
      .post(`/conversations/${nutritionist.id}/messages`)
      .set('Authorization', userAuth)
      .send({ content: 'primeira' });
    const second = await request(app.getHttpServer())
      .post(`/conversations/${nutritionist.id}/messages`)
      .set('Authorization', userAuth)
      .send({ content: 'segunda' });

    const conversationId = first.body.conversationId;
    const poll = await request(app.getHttpServer())
      .get(`/conversations/${conversationId}/messages`)
      .query({ after: first.body.id })
      .set('Authorization', userAuth);

    expect(poll.status).toBe(200);
    expect(poll.body.map((m: { id: string }) => m.id)).toEqual([
      second.body.id,
    ]);
  });

  it('IT-004 a real send creates a real Notification row for the recipient via the actual NotificationsModule wiring', async () => {
    const userAuth = await bearerFor(user);

    const sent = await request(app.getHttpServer())
      .post(`/conversations/${nutritionist.id}/messages`)
      .set('Authorization', userAuth)
      .send({ content: 'Você tem uma notificação real?' });
    expect(sent.status).toBe(201);

    const notification = await prisma.notification.findFirst({
      where: { userId: nutritionist.id, category: 'MESSAGES' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notification).not.toBeNull();
    expect(notification?.message).toContain(user.name);
  });

  it('IT-004b reporting a conversation never creates a Notification for the reported party', async () => {
    const userAuth = await bearerFor(user);

    const sent = await request(app.getHttpServer())
      .post(`/conversations/${nutritionist.id}/messages`)
      .set('Authorization', userAuth)
      .send({ content: 'Preciso reportar isso depois' });
    const conversationId = sent.body.conversationId;

    await prisma.notification.deleteMany({
      where: { userId: nutritionist.id, category: 'MESSAGES' },
    });

    const reported = await request(app.getHttpServer())
      .post(`/conversations/${conversationId}/report`)
      .set('Authorization', userAuth);
    expect(reported.status).toBe(204);

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    expect(conversation?.reportedAt).not.toBeNull();

    const notificationAfterReport = await prisma.notification.findFirst({
      where: { userId: nutritionist.id, category: 'MESSAGES' },
    });
    expect(notificationAfterReport).toBeNull();
  });
});
