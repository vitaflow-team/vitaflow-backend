/**
 * Integration tests for PRD `professional-discovery` (task_02, backend).
 *
 * Runs the real ProfessionalSearchController/ConnectionRequestsController/
 * ProfessionalProfileController, their services/repositories, AuthGuard,
 * ProfessionalGuard, and the app's global ValidationPipe against an isolated
 * database. The real ClientsModule wiring (ClientRegisterService,
 * ClientsRepository) runs unmocked (_tests.md Strategy) so IT-004 can verify
 * the created Client row's actual shape. Only MailService is mocked at the
 * module boundary, same as the notifications feature's own e2e suite — no
 * automated test calls a real SMTP server.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { ClientRegisterService } from '@/clients/register/client.register.service';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { MailService } from '@/mail/mail.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { ConnectionRequestsController } from '@/professional-discovery/connectionRequests.controller';
import { ProfessionalDiscoveryService } from '@/professional-discovery/professionalDiscovery.service';
import { ProfessionalProfileController } from '@/professional-discovery/professionalProfile.controller';
import { ProfessionalSearchController } from '@/professional-discovery/professionalSearch.controller';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { ProfessionalDiscoveryRepository } from '@/repositories/professional-discovery/professionalDiscovery.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(30_000);

const RUN_TAG = `prodisc-${Date.now()}`;

describe('Professional Discovery integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let nutritionistA: Users; // has a ProfessionalProfile row
  let educatorB: Users; // no ProfessionalProfile row (US-001.EC-2, UT-003/UT-006)
  let requester: Users;
  const sendNotificationEmail = jest.fn();
  const jwtSecret = 'professional-discovery-integration-jwt-secret';

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
      controllers: [
        ProfessionalSearchController,
        ConnectionRequestsController,
        ProfessionalProfileController,
      ],
      providers: [
        PrismaService,
        UserRepository,
        ProfessionalDiscoveryRepository,
        ProfessionalDiscoveryService,
        ProfessionalGuard,
        AuthGuard,
        ClientsRepository,
        ClientRegisterService,
        NotificationsRepository,
        NotificationsService,
        { provide: MailService, useValue: { sendNotificationEmail } },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);

    await seedUsers();
  });

  beforeEach(() => {
    sendNotificationEmail.mockReset();
  });

  afterEach(async () => {
    const professionalIds = [nutritionistA.id, educatorB.id];
    await prisma.connectionRequest.deleteMany({
      where: {
        OR: [
          { userId: requester.id },
          { professionalId: { in: professionalIds } },
        ],
      },
    });
    await prisma.client.deleteMany({
      where: { professionalId: { in: professionalIds } },
    });
    await prisma.notification.deleteMany({
      where: { userId: { in: [...professionalIds, requester.id] } },
    });
  });

  afterAll(async () => {
    const userIds = [nutritionistA, educatorB, requester]
      .filter(Boolean)
      .map((u) => u.id);
    await prisma.professionalProfile.deleteMany({
      where: { userId: { in: userIds } },
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
            {
              name: `${RUN_TAG} educator`,
              price: 10,
              type: ProductType.PHYSICAL_EDUCATOR,
            },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    const nutriProduct = group.products.find((p) => p.type === 'NUTRITIONIST')!;
    const educatorProduct = group.products.find(
      (p) => p.type === 'PHYSICAL_EDUCATOR',
    )!;

    nutritionistA = await createUser('nutri-a', { productId: nutriProduct.id });
    educatorB = await createUser('educator-b', {
      productId: educatorProduct.id,
    });
    requester = await createUser('requester', {});

    await prisma.professionalProfile.create({
      data: {
        userId: nutritionistA.id,
        bio: 'Bio da nutricionista',
        specialty: 'Nutrição esportiva',
        priceFrom: 150,
        attendsOnline: true,
      },
    });
  }

  async function createUser(
    label: string,
    extra: Partial<Prisma.UsersUncheckedCreateInput>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Professional Discovery ${label}`,
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

  it('IT-001 search combines type/specialty/price/online filters', async () => {
    const auth = await bearerFor(requester);

    const byType = await request(app.getHttpServer())
      .get('/professionals')
      .query({ type: 'PHYSICAL_EDUCATOR' })
      .set('Authorization', auth);
    expect(byType.status).toBe(200);
    const byTypeIds = byType.body.map((p: { id: string }) => p.id);
    expect(byTypeIds).toContain(educatorB.id);
    expect(byTypeIds).not.toContain(nutritionistA.id);

    const combined = await request(app.getHttpServer())
      .get('/professionals')
      .query({ specialty: 'esportiva', priceMax: 200, online: true })
      .set('Authorization', auth);
    expect(combined.status).toBe(200);
    expect(combined.body.map((p: { id: string }) => p.id)).toEqual([
      nutritionistA.id,
    ]);

    const tooExpensive = await request(app.getHttpServer())
      .get('/professionals')
      .query({ priceMax: 10 })
      .set('Authorization', auth);
    expect(tooExpensive.body.map((p: { id: string }) => p.id)).not.toContain(
      nutritionistA.id,
    );
  });

  it('IT-002 returns 200 for a profile with and without ProfessionalProfile data', async () => {
    const auth = await bearerFor(requester);

    const withProfile = await request(app.getHttpServer())
      .get(`/professionals/${nutritionistA.id}`)
      .set('Authorization', auth);
    expect(withProfile.status).toBe(200);
    expect(withProfile.body.bio).toBe('Bio da nutricionista');
    expect(withProfile.body.specialty).toBe('Nutrição esportiva');

    const withoutProfile = await request(app.getHttpServer())
      .get(`/professionals/${educatorB.id}`)
      .set('Authorization', auth);
    expect(withoutProfile.status).toBe(200);
    expect(withoutProfile.body.bio).toBeNull();
    expect(withoutProfile.body.specialty).toBeNull();
  });

  it('IT-003 refuses a second pending request to the same professional with 409', async () => {
    const auth = await bearerFor(requester);

    const first = await request(app.getHttpServer())
      .post(`/professionals/${nutritionistA.id}/connection-requests`)
      .set('Authorization', auth);
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post(`/professionals/${nutritionistA.id}/connection-requests`)
      .set('Authorization', auth);
    expect(second.status).toBe(409);
  });

  it('IT-004 accepting a request creates a real Client row shaped like the professional-initiated flow', async () => {
    const auth = await bearerFor(requester);
    const professionalAuth = await bearerFor(nutritionistA);

    const created = await request(app.getHttpServer())
      .post(`/professionals/${nutritionistA.id}/connection-requests`)
      .set('Authorization', auth);
    expect(created.status).toBe(201);

    const accepted = await request(app.getHttpServer())
      .post(`/connection-requests/${created.body.id}/accept`)
      .set('Authorization', professionalAuth);
    expect(accepted.status).toBe(204);

    const client = await prisma.client.findFirst({
      where: { professionalId: nutritionistA.id, email: requester.email },
    });
    expect(client).not.toBeNull();
    expect(client?.userId).toBe(requester.id);
    expect(client?.name).toBe(requester.name);
    expect(client?.professionalId).toBe(nutritionistA.id);
  });

  it('IT-005 the professional sees only their own incoming queue; declining creates no Client row', async () => {
    const auth = await bearerFor(requester);
    const nutriAuth = await bearerFor(nutritionistA);
    const educatorAuth = await bearerFor(educatorB);

    const created = await request(app.getHttpServer())
      .post(`/professionals/${nutritionistA.id}/connection-requests`)
      .set('Authorization', auth);
    expect(created.status).toBe(201);

    const educatorQueue = await request(app.getHttpServer())
      .get('/connection-requests/incoming')
      .set('Authorization', educatorAuth);
    expect(educatorQueue.body).toEqual([]);

    const nutriQueue = await request(app.getHttpServer())
      .get('/connection-requests/incoming')
      .set('Authorization', nutriAuth);
    expect(nutriQueue.body.map((r: { id: string }) => r.id)).toContain(
      created.body.id,
    );

    const declined = await request(app.getHttpServer())
      .post(`/connection-requests/${created.body.id}/decline`)
      .set('Authorization', nutriAuth);
    expect(declined.status).toBe(204);

    const client = await prisma.client.findFirst({
      where: { professionalId: nutritionistA.id, email: requester.email },
    });
    expect(client).toBeNull();
  });

  it('IT-006 exactly one of two concurrent accepts succeeds; the other gets 404', async () => {
    const auth = await bearerFor(requester);
    const professionalAuth = await bearerFor(nutritionistA);

    const created = await request(app.getHttpServer())
      .post(`/professionals/${nutritionistA.id}/connection-requests`)
      .set('Authorization', auth);
    expect(created.status).toBe(201);

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/connection-requests/${created.body.id}/accept`)
        .set('Authorization', professionalAuth),
      request(app.getHttpServer())
        .post(`/connection-requests/${created.body.id}/accept`)
        .set('Authorization', professionalAuth),
    ]);

    // void-returning endpoints answer 204 in this codebase, not 200 —
    // _tests.md's "200" reads as generic success-status phrasing, not a
    // literal contract distinct from the established @HttpCode(204) rule
    // every other void mutation in this codebase follows.
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([204, 404]);
  });
});
