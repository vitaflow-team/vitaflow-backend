/**
 * Integration tests for PRD `educator-student-record` (task_01, backend).
 *
 * Runs the real StudentsController/StudentsService, the repositories, AuthGuard,
 * PhysicalEducatorGuard, the lookup throttler and the app's global
 * ValidationPipe against an isolated database.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { AccountLookupThrottlerGuard } from '@/educator-students/students/accountLookupThrottler.guard';
import { StudentsController } from '@/educator-students/students/students.controller';
import { StudentsService } from '@/educator-students/students/students.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { Prisma, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { FixedSessionsService } from '@/scheduling/fixed-times/fixedSessions.service';
import { Clock } from '@/scheduling/clock.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { MailService } from '@/mail/mail.service';
jest.setTimeout(60_000);

const RUN_TAG = `edu-students-${Date.now()}`;
const RANDOM_UUID = '01890a5d-ac96-774b-bcce-b302099a8099';

describe('Educator students integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let educatorA: Users;
  let educatorB: Users;
  let educatorC: Users;
  let nutritionist: Users;
  let regularUser: Users;
  let confirmedAccount: Users;
  let pendingAccount: Users;
  const jwtSecret = 'educator-students-integration-jwt-secret';

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
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
      ],
      controllers: [StudentsController],
      providers: [
        {
          provide: MailService,
          useValue: { sendNotificationEmail: jest.fn() },
        },
        FixedTimesRepository,
        FixedSessionsService,
        Clock,
        EducatorWorkoutsRepository,
        NotificationsService,
        NotificationsRepository,
        PrismaService,
        UserRepository,
        ClientsRepository,
        PhysicalAssessmentsRepository,
        EducatorWorkoutsRepository,
        StudentsService,
        AuthGuard,
        PhysicalEducatorGuard,
        AccountLookupThrottlerGuard,
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);

    await seed();
  });

  afterEach(async () => {
    await prisma.client.deleteMany({
      where: {
        professionalId: {
          in: [educatorA.id, educatorB.id, educatorC.id, nutritionist.id],
        },
      },
    });
  });

  afterAll(async () => {
    const users = [
      educatorA,
      educatorB,
      educatorC,
      nutritionist,
      regularUser,
      confirmedAccount,
      pendingAccount,
    ].filter(Boolean);
    const ids = users.map((u) => u.id);
    await prisma.featureConsent.deleteMany({ where: { userId: { in: ids } } });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
    await prisma.product.deleteMany({ where: { groupId } });
    await prisma.productGroup.deleteMany({ where: { id: groupId } });
    await prisma.$disconnect();
    await app.close();
  });

  async function seed(): Promise<void> {
    const group = await prisma.productGroup.create({
      data: {
        name: `${RUN_TAG} group`,
        products: {
          create: [
            {
              name: `${RUN_TAG} educator`,
              price: 10,
              type: ProductType.PHYSICAL_EDUCATOR,
            },
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
    const educatorProduct = group.products.find(
      (p) => p.type === ProductType.PHYSICAL_EDUCATOR,
    )!;
    const nutriProduct = group.products.find(
      (p) => p.type === ProductType.NUTRITIONIST,
    )!;

    educatorA = await createUser('educator-a', {
      productId: educatorProduct.id,
    });
    educatorB = await createUser('educator-b', {
      productId: educatorProduct.id,
    });
    educatorC = await createUser('educator-c', {
      productId: educatorProduct.id,
    });
    nutritionist = await createUser('nutri', { productId: nutriProduct.id });
    regularUser = await createUser('regular', {});
    confirmedAccount = await createUser('confirmed', {
      name: 'Diego Confirmado',
    });
    pendingAccount = await createUser('pending', {
      name: 'Pedro Pendente',
      active: false,
    });
  }

  async function createUser(
    label: string,
    extra: Partial<Prisma.UsersUncheckedCreateInput>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Students ${label}`,
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

  async function as(target: Users) {
    const auth = await bearerFor(target);
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set('Authorization', auth),
      post: (url: string, body: object) =>
        request(server).post(url).set('Authorization', auth).send(body),
      patch: (url: string, body: object) =>
        request(server).patch(url).set('Authorization', auth).send(body),
      del: (url: string) =>
        request(server).delete(url).set('Authorization', auth),
    };
  }

  const register = (email: string, extra: object = {}) => ({
    name: 'Aluno Teste',
    email,
    linkExistingAccount: false,
    ...extra,
  });

  it('IT-001 educator A registers a student that educator B never sees, and a duplicate is refused', async () => {
    const a = await as(educatorA);
    const b = await as(educatorB);

    const created = await a.post(
      '/educator/students',
      register(`${RUN_TAG}-one@integration.test`),
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      hasAccount: false,
      overview: { latest: null, variation: null },
    });

    const list = await a.get('/educator/students');
    expect(list.body.items).toEqual([
      expect.objectContaining({
        email: `${RUN_TAG}-one@integration.test`,
        hasAccount: false,
        lastAssessedOn: null,
      }),
    ]);

    const duplicate = await a.post(
      '/educator/students',
      register(`${RUN_TAG}-ONE@integration.test`),
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('student_already_registered');

    const other = await b.get('/educator/students');
    expect(other.body.items).toEqual([]);
  });

  it('IT-002 two educators register the same e-mail as two separate records', async () => {
    const a = await as(educatorA);
    const b = await as(educatorB);
    const email = `${RUN_TAG}-same@integration.test`;

    const first = await a.post('/educator/students', register(email));
    const second = await b.post('/educator/students', register(email));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);
    expect((await b.get(`/educator/students/${first.body.id}`)).status).toBe(
      404,
    );
    expect((await a.get(`/educator/students/${first.body.id}`)).status).toBe(
      200,
    );
  });

  it('answers a foreign, an unknown and a malformed student id with the same 404', async () => {
    const a = await as(educatorA);
    const b = await as(educatorB);
    const created = await a.post(
      '/educator/students',
      register(`${RUN_TAG}-iso@integration.test`),
    );

    const calls = [
      await b.get(`/educator/students/${created.body.id}`),
      await b.patch(`/educator/students/${created.body.id}`, { name: 'X' }),
      await b.del(`/educator/students/${created.body.id}`),
      await b.get(`/educator/students/${RANDOM_UUID}`),
      await b.get('/educator/students/not-a-uuid'),
    ];

    for (const response of calls) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        statusCode: 404,
        message: 'Aluno não encontrado.',
        code: 'student_not_found',
      });
    }
    expect((await a.get(`/educator/students/${created.body.id}`)).status).toBe(
      200,
    );
  });

  it('looks up only confirmed accounts and links only after confirmation', async () => {
    const a = await as(educatorA);

    const found = await a.get('/educator/students/account-lookup').query({
      email: confirmedAccount.email.toUpperCase(),
    });
    const pending = await a.get('/educator/students/account-lookup').query({
      email: pendingAccount.email,
    });
    expect(found.body).toEqual({ found: true, name: 'Diego Confirmado' });
    expect(pending.body).toEqual({ found: false, name: null });

    const hidden = await a.post(
      '/educator/students',
      register(confirmedAccount.email),
    );
    expect(hidden.status).toBe(409);
    expect(hidden.body.code).toBe('account_exists');
    expect(
      await prisma.client.count({
        where: { professionalId: educatorA.id, email: confirmedAccount.email },
      }),
    ).toBe(0);

    const linked = await a.post('/educator/students', {
      email: confirmedAccount.email,
      linkExistingAccount: true,
    });
    expect(linked.status).toBe(201);
    expect(linked.body).toMatchObject({
      hasAccount: true,
      name: 'Diego Confirmado',
    });
    const stored = await prisma.client.findUnique({
      where: { id: linked.body.id as string },
    });
    expect(stored?.userId).toBe(confirmedAccount.id);

    const unlinked = await a.post('/educator/students', {
      email: pendingAccount.email,
      linkExistingAccount: true,
    });
    expect(unlinked.status).toBe(404);
    expect(unlinked.body.code).toBe('account_not_found');

    const unconfirmedRegistration = await a.post(
      '/educator/students',
      register(pendingAccount.email),
    );
    expect(unconfirmedRegistration.status).toBe(201);
    expect(unconfirmedRegistration.body.hasAccount).toBe(false);
  });

  it('refuses a registration with the educator own e-mail and a linked student e-mail change', async () => {
    const a = await as(educatorA);

    const self = await a.post('/educator/students', {
      email: educatorA.email,
      linkExistingAccount: true,
    });
    expect(self.status).toBe(400);
    expect(self.body.code).toBe('self_registration');

    const linked = await a.post('/educator/students', {
      email: confirmedAccount.email,
      linkExistingAccount: true,
    });
    const locked = await a.patch(`/educator/students/${linked.body.id}`, {
      email: 'other@integration.test',
    });
    expect(locked.status).toBe(400);
    expect(locked.body.code).toBe('email_locked');
  });

  it('IT-013 two simultaneous registrations of the same e-mail leave exactly one student', async () => {
    const a = await as(educatorA);
    const body = register(`${RUN_TAG}-race@integration.test`);

    const [first, second] = await Promise.all([
      a.post('/educator/students', body),
      a.post('/educator/students', body),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(
      await prisma.client.count({
        where: {
          professionalId: educatorA.id,
          email: `${RUN_TAG}-race@integration.test`,
        },
      }),
    ).toBe(1);
  });

  it('IT-015 searches accent-insensitively over all students, pages by 50 and treats % as text', async () => {
    const a = await as(educatorA);
    await prisma.client.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        name: i === 7 ? 'João Álvares' : `Aluno ${String(i).padStart(2, '0')}`,
        email: `${RUN_TAG}-bulk-${i}@integration.test`,
        phone: '',
        professionalId: educatorA.id,
      })),
    });

    const first = await a.get('/educator/students');
    const second = await a.get('/educator/students').query({ page: 2 });
    const accent = await a
      .get('/educator/students')
      .query({ search: 'joao alvares' });
    const percent = await a.get('/educator/students').query({ search: '%' });
    const beyond = await a
      .get('/educator/students')
      .query({ search: 'aluno 54' });

    expect(first.body.items).toHaveLength(50);
    expect(first.body.total).toBe(55);
    expect(second.body.items).toHaveLength(5);
    expect(accent.body.items.map((s: { name: string }) => s.name)).toEqual([
      'João Álvares',
    ]);
    expect(percent.body.total).toBe(0);
    expect(beyond.body.total).toBe(1);
    expect((await a.get('/educator/students').query({ page: 0 })).status).toBe(
      400,
    );
  });

  it('IT-016 limits the account lookup to 10 per minute per educator and exposes only found and name', async () => {
    const c = await as(educatorC);
    const statuses: number[] = [];
    let sample: object | undefined;

    for (let i = 0; i < 11; i += 1) {
      const response = await c.get('/educator/students/account-lookup').query({
        email:
          i % 2 === 0 ? confirmedAccount.email : `nobody-${i}@integration.test`,
      });
      statuses.push(response.status);
      if (response.status === 200) sample = response.body as object;
    }

    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(Object.keys(sample!).sort()).toEqual(['found', 'name']);

    const b = await as(educatorB);
    const other = await b.get('/educator/students/account-lookup').query({
      email: confirmedAccount.email,
    });
    expect(other.status).toBe(200);
  });

  it('IT-019 deleting a student removes its assessments, and the consent enum value exists', async () => {
    const a = await as(educatorA);
    const created = await a.post(
      '/educator/students',
      register(`${RUN_TAG}-cascade@integration.test`),
    );
    const clientId = created.body.id as string;
    await prisma.physicalAssessment.createMany({
      data: [
        {
          clientId,
          assessedOn: new Date('2026-08-18'),
          weightKg: 79,
          heightCm: 179,
        },
        {
          clientId,
          assessedOn: new Date('2026-09-15'),
          weightKg: 78.2,
          heightCm: 179,
        },
      ],
    });

    const detail = await a.get(`/educator/students/${clientId}`);
    expect(detail.body.overview.latest).toMatchObject({
      assessedOn: '2026-09-15',
      weightKg: 78.2,
    });
    expect(detail.body.overview.variation).toEqual({
      weightKg: -0.8,
      bodyFatPoints: null,
    });
    const listed = await a.get('/educator/students');
    expect(listed.body.items[0].lastAssessedOn).toBe('2026-09-15');

    expect((await a.del(`/educator/students/${clientId}`)).status).toBe(204);
    expect(await prisma.physicalAssessment.count({ where: { clientId } })).toBe(
      0,
    );
    expect((await a.del(`/educator/students/${clientId}`)).status).toBe(404);

    const consent = await prisma.featureConsent.create({
      data: {
        userId: educatorA.id,
        feature: 'PHYSICAL_ASSESSMENT_RECORDING',
      },
    });
    expect(consent.feature).toBe('PHYSICAL_ASSESSMENT_RECORDING');
  });

  it('refuses other professions and anonymous callers on every route', async () => {
    const routes = [
      ['get', '/educator/students'],
      ['get', '/educator/students/account-lookup?email=a@b.com'],
      ['get', `/educator/students/${RANDOM_UUID}`],
    ] as const;

    for (const [, url] of routes) {
      expect((await request(app.getHttpServer()).get(url)).status).toBe(401);
    }
    for (const who of [nutritionist, regularUser]) {
      const caller = await as(who);
      for (const [, url] of routes) {
        expect((await caller.get(url)).status).toBe(403);
      }
      expect(
        (
          await caller.post(
            '/educator/students',
            register('x@integration.test'),
          )
        ).status,
      ).toBe(403);
      expect(
        (await caller.del(`/educator/students/${RANDOM_UUID}`)).status,
      ).toBe(403);
    }
  });
});
