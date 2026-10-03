/**
 * Integration tests for PRD `educator-student-record` (task_02, backend).
 *
 * Runs the real assessments, declaration, progress and mirror controllers and
 * services, the repositories, AuthGuard, PhysicalEducatorGuard and the app's
 * global ValidationPipe against an isolated database. The professional
 * profile lookup of Professional Discovery is the only stub: the mirror only
 * needs the educator's identity from it.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { ConsentRepository } from '@/common/consent/consent.repository';
import { ConsentService } from '@/common/consent/consent.service';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { AssessmentsController } from '@/educator-students/assessments/assessments.controller';
import { AssessmentsService } from '@/educator-students/assessments/assessments.service';
import { DeclarationController } from '@/educator-students/assessments/declaration.controller';
import { AccountLookupThrottlerGuard } from '@/educator-students/students/accountLookupThrottler.guard';
import { StudentsController } from '@/educator-students/students/students.controller';
import { StudentsService } from '@/educator-students/students/students.service';
import { ProfessionalDiscoveryService } from '@/professional-discovery/professionalDiscovery.service';
import { ProfessionalMirrorController } from '@/professional-mirror/professionalMirror.controller';
import { ProfessionalMirrorService } from '@/professional-mirror/professionalMirror.service';
import { ProgressController } from '@/progress/progress.controller';
import { ProgressService } from '@/progress/progress.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
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

const RUN_TAG = `edu-assess-${Date.now()}`;
const RANDOM_UUID = '01890a5d-ac96-774b-bcce-b302099a8099';

// A calendar day `n` days before today in Brasília time (UTC-3).
function daysAgo(n: number): string {
  const base = new Date(Date.now() - 3 * 60 * 60 * 1000);
  base.setUTCDate(base.getUTCDate() - n);
  return base.toISOString().slice(0, 10);
}

describe('Educator assessments integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clientsRepo: ClientsRepository;
  let jwtService: JwtService;
  let groupId: string;
  let educatorA: Users;
  let educatorB: Users;
  let nutritionist: Users;
  let regularUser: Users;
  let student: Users;
  const jwtSecret = 'educator-assessments-integration-jwt-secret';

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
      controllers: [
        StudentsController,
        AssessmentsController,
        DeclarationController,
        ProgressController,
        ProfessionalMirrorController,
      ],
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
        MeasurementRecordsRepository,
        ConsentRepository,
        ConsentService,
        StudentsService,
        AssessmentsService,
        ProgressService,
        ProfessionalMirrorService,
        AuthGuard,
        PhysicalEducatorGuard,
        AccountLookupThrottlerGuard,
        {
          provide: ProfessionalDiscoveryService,
          useValue: {
            getProfile: async (id: string) => {
              const row = await prisma.users.findUniqueOrThrow({
                where: { id },
              });
              return { id: row.id, name: row.name, specialty: null };
            },
          },
        },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    clientsRepo = moduleFixture.get(ClientsRepository);
    jwtService = moduleFixture.get(JwtService);

    await seed();
  });

  afterEach(async () => {
    const ids = [educatorA.id, educatorB.id, nutritionist.id];
    await prisma.client.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.measurementRecord.deleteMany({
      where: { userId: student.id },
    });
    await prisma.featureConsent.deleteMany({ where: { userId: { in: ids } } });
  });

  afterAll(async () => {
    const users = [
      educatorA,
      educatorB,
      nutritionist,
      regularUser,
      student,
    ].filter(Boolean);
    const ids = users.map((u) => u.id);
    await prisma.featureConsent.deleteMany({ where: { userId: { in: ids } } });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
    await prisma.users.deleteMany({
      where: { email: { startsWith: `${RUN_TAG}-late` } },
    });
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
      name: 'Thiago Ramos',
      productId: educatorProduct.id,
    });
    educatorB = await createUser('educator-b', {
      name: 'Marina Costa',
      productId: educatorProduct.id,
    });
    nutritionist = await createUser('nutri', { productId: nutriProduct.id });
    regularUser = await createUser('regular', {});
    student = await createUser('student', { name: 'Diego Aluno' });
  }

  async function createUser(
    label: string,
    extra: Partial<Prisma.UsersUncheckedCreateInput>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Assess ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        ...extra,
      },
    });
  }

  async function as(target: Users) {
    const token = await jwtService.signAsync({
      id: target.id,
      email: target.email,
    });
    const auth = `Bearer ${token}`;
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        request(server).post(url).set('Authorization', auth).send(body),
      patch: (url: string, body: object) =>
        request(server).patch(url).set('Authorization', auth).send(body),
      put: (url: string, body: object) =>
        request(server).put(url).set('Authorization', auth).send(body),
      del: (url: string) =>
        request(server).delete(url).set('Authorization', auth),
    };
  }

  // Registers a student of `educator` (optionally linked to `account`).
  async function registerStudent(
    educator: Users,
    email: string,
    link = false,
  ): Promise<string> {
    const caller = await as(educator);
    const response = await caller.post(
      '/educator/students',
      link
        ? { email, linkExistingAccount: true }
        : { name: 'Aluno Teste', email, linkExistingAccount: false },
    );
    expect(response.status).toBe(201);
    return response.body.id as string;
  }

  const values = (assessedOn: string, extra: object = {}) => ({
    assessedOn,
    weightKg: 78.2,
    heightCm: 179,
    ...extra,
  });

  async function accept(educator: Users): Promise<void> {
    await prisma.featureConsent.create({
      data: { userId: educator.id, feature: 'PHYSICAL_ASSESSMENT_RECORDING' },
    });
  }

  it('IT-003 links an account, saves an assessment and the student reads it in the mirror', async () => {
    const a = await as(educatorA);
    const s = await as(student);

    const lookup = await a
      .get('/educator/students/account-lookup')
      .query({ email: student.email });
    expect(lookup.body).toEqual({ found: true, name: 'Diego Aluno' });

    const studentId = await registerStudent(educatorA, student.email, true);
    expect(
      (await a.get(`/educator/students/${studentId}`)).body.hasAccount,
    ).toBe(true);

    const saved = await a.post(
      `/educator/students/${studentId}/assessments`,
      values(daysAgo(2), { bodyFatPercent: 18.4, acceptDeclaration: true }),
    );
    expect(saved.status).toBe(201);

    const mirror = await s.get('/me/physical-educator');
    expect(mirror.status).toBe(200);
    expect(mirror.body.professional).toMatchObject({ name: 'Thiago Ramos' });
    expect(mirror.body.physicalAssessment).toEqual([
      {
        id: saved.body.id,
        assessedOn: daysAgo(2),
        weightKg: 78.2,
        bodyFatPercent: 18.4,
      },
    ]);
  });

  it('IT-004 and IT-005 a record saved before the account is activated is linked on activation and removed ones are not', async () => {
    const email = `${RUN_TAG}-late@integration.test`;
    const a = await as(educatorA);
    await accept(educatorA);

    const lookup = await a
      .get('/educator/students/account-lookup')
      .query({ email });
    expect(lookup.body).toEqual({ found: false, name: null });

    const keptId = await registerStudent(educatorA, email);
    const removedId = await registerStudent(educatorB, email);
    await a.post(
      `/educator/students/${keptId}/assessments`,
      values(daysAgo(5), { weightKg: 80 }),
    );
    const b = await as(educatorB);
    expect((await b.del(`/educator/students/${removedId}`)).status).toBe(204);

    // The account is created and activated (activation and the first Google
    // sign-in both end in this same link call on the confirmed account).
    const late = await createUser('late', {
      name: 'Late Aluno',
      email,
      active: false,
    });
    const before = await (await as(late)).get('/progress-records/dashboard');
    expect(before.body.history).toEqual([]);

    await prisma.users.update({
      where: { id: late.id },
      data: { active: true },
    });
    await clientsRepo.setAllClientUser(late.id, email);

    const after = await (await as(late)).get('/progress-records/dashboard');
    expect(after.status).toBe(200);
    expect(after.body.history).toEqual([
      expect.objectContaining({
        source: 'EDUCATOR',
        readOnly: true,
        educatorName: 'Thiago Ramos',
        weightKg: 80,
      }),
    ]);
    expect(await prisma.client.count({ where: { id: removedId } })).toBe(0);
  });

  it('IT-006 answers every foreign student or assessment call with the same 404 as a random id', async () => {
    const a = await as(educatorA);
    const b = await as(educatorB);
    await accept(educatorA);
    const studentId = await registerStudent(
      educatorA,
      `${RUN_TAG}-own@integration.test`,
    );
    const created = await a.post(
      `/educator/students/${studentId}/assessments`,
      values(daysAgo(3)),
    );
    const assessmentId = created.body.id as string;
    const base = `/educator/students/${studentId}/assessments`;

    const foreign = [
      await b.get(base),
      await b.post(base, values(daysAgo(1))),
      await b.patch(`${base}/${assessmentId}`, values(daysAgo(1))),
      await b.del(`${base}/${assessmentId}`),
    ];
    const unknown = [
      await b.get(`/educator/students/${RANDOM_UUID}/assessments`),
      await b.post(
        `/educator/students/${RANDOM_UUID}/assessments`,
        values(daysAgo(1)),
      ),
      await b.patch(
        `/educator/students/${RANDOM_UUID}/assessments/${RANDOM_UUID}`,
        values(daysAgo(1)),
      ),
      await b.del(
        `/educator/students/${RANDOM_UUID}/assessments/${RANDOM_UUID}`,
      ),
    ];

    foreign.forEach((response, i) => {
      expect(response.status).toBe(404);
      expect(response.body).toEqual(unknown[i].body);
    });
    expect(
      await prisma.physicalAssessment.count({ where: { clientId: studentId } }),
    ).toBe(1);
  });

  it('IT-007 requires the one-time declaration on the first save only, per educator', async () => {
    const a = await as(educatorA);
    const b = await as(educatorB);
    const studentA = await registerStudent(
      educatorA,
      `${RUN_TAG}-decl-a@integration.test`,
    );
    const studentB = await registerStudent(
      educatorB,
      `${RUN_TAG}-decl-b@integration.test`,
    );

    expect((await a.get('/educator/students')).status).toBe(200);
    expect(
      (await a.get(`/educator/students/${studentA}/assessments`)).status,
    ).toBe(200);
    expect((await a.get('/educator/assessment-declaration')).body).toEqual({
      accepted: false,
    });

    const refused = await a.post(
      `/educator/students/${studentA}/assessments`,
      values(daysAgo(1)),
    );
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('declaration_required');
    expect(
      await prisma.physicalAssessment.count({ where: { clientId: studentA } }),
    ).toBe(0);
    expect(
      await prisma.featureConsent.count({ where: { userId: educatorA.id } }),
    ).toBe(0);

    const accepted = await a.post(
      `/educator/students/${studentA}/assessments`,
      values(daysAgo(1), { acceptDeclaration: true }),
    );
    expect(accepted.status).toBe(201);
    expect(
      await prisma.featureConsent.count({ where: { userId: educatorA.id } }),
    ).toBe(1);

    const later = await a.post(
      `/educator/students/${studentA}/assessments`,
      values(daysAgo(2)),
    );
    expect(later.status).toBe(201);
    expect((await a.get('/educator/assessment-declaration')).body).toEqual({
      accepted: true,
    });

    const other = await b.post(
      `/educator/students/${studentB}/assessments`,
      values(daysAgo(1)),
    );
    expect(other.status).toBe(403);
  });

  it('IT-008 removing a student removes its assessments and unlinks the student view', async () => {
    const a = await as(educatorA);
    const s = await as(student);
    await accept(educatorA);
    await prisma.measurementRecord.create({
      data: { userId: student.id, weightKg: 70, heightCm: 168 },
    });
    const studentId = await registerStudent(educatorA, student.email, true);
    for (const day of [daysAgo(20), daysAgo(10), daysAgo(1)]) {
      await a.post(`/educator/students/${studentId}/assessments`, values(day));
    }
    expect(
      (await s.get('/progress-records/dashboard')).body.history,
    ).toHaveLength(4);

    expect((await a.del(`/educator/students/${studentId}`)).status).toBe(204);

    expect(
      await prisma.physicalAssessment.count({ where: { clientId: studentId } }),
    ).toBe(0);
    const dashboard = await s.get('/progress-records/dashboard');
    expect(dashboard.body.history).toHaveLength(1);
    expect(dashboard.body.history[0].source).toBe('SELF');
    expect((await s.get('/me/physical-educator')).body).toEqual({
      hasProfessional: false,
    });
    expect(await prisma.users.count({ where: { id: student.id } })).toBe(1);

    const again = await registerStudent(educatorA, student.email, true);
    expect(
      (await a.get(`/educator/students/${again}/assessments`)).body.items,
    ).toEqual([]);
  });

  it('IT-009 merges labeled educator points, keeps them read-only for the student and follows educator edits', async () => {
    const a = await as(educatorA);
    const s = await as(student);
    await accept(educatorA);
    const own = await prisma.measurementRecord.create({
      data: { userId: student.id, weightKg: 70, heightCm: 168 },
    });
    const studentId = await registerStudent(educatorA, student.email, true);
    const created = await a.post(
      `/educator/students/${studentId}/assessments`,
      values(daysAgo(3), { weightKg: 78 }),
    );
    const assessmentId = created.body.id as string;

    const dashboard = await s.get('/progress-records/dashboard');
    expect(dashboard.status).toBe(200);
    const sources = dashboard.body.history.map(
      (p: { source: string }) => p.source,
    );
    expect(sources.sort()).toEqual(['EDUCATOR', 'SELF']);
    expect(
      dashboard.body.history.find(
        (p: { source: string }) => p.source === 'EDUCATOR',
      ),
    ).toMatchObject({
      id: assessmentId,
      readOnly: true,
      educatorName: 'Thiago Ramos',
      weightKg: 78,
    });
    expect(
      dashboard.body.history.find((p: { id: string }) => p.id === own.id),
    ).toMatchObject({ source: 'SELF', readOnly: false });

    expect(
      (
        await s.patch(`/progress-records/${assessmentId}`, {
          weightKg: 60,
          heightCm: 170,
        })
      ).status,
    ).toBe(404);
    expect((await s.del(`/progress-records/${assessmentId}`)).status).toBe(404);
    expect(
      (
        await prisma.physicalAssessment.findUnique({
          where: { id: assessmentId },
        })
      )?.weightKg,
    ).toBe(78);

    const edited = await a.patch(
      `/educator/students/${studentId}/assessments/${assessmentId}`,
      values(daysAgo(3), { weightKg: 77.1 }),
    );
    expect(edited.status).toBe(200);
    const afterEdit = await s.get('/progress-records/dashboard');
    expect(
      afterEdit.body.history.find((p: { id: string }) => p.id === assessmentId),
    ).toMatchObject({ weightKg: 77.1, readOnly: true });

    expect(
      (
        await a.del(
          `/educator/students/${studentId}/assessments/${assessmentId}`,
        )
      ).status,
    ).toBe(204);
    const afterDelete = await s.get('/progress-records/dashboard');
    expect(afterDelete.body.history.map((p: { id: string }) => p.id)).toEqual([
      own.id,
    ]);
  });

  it('IT-010 gives the linked student the latest three assessments and no educator route', async () => {
    const a = await as(educatorA);
    const s = await as(student);
    await accept(educatorA);
    const studentId = await registerStudent(educatorA, student.email, true);

    expect(
      (await s.get('/me/physical-educator')).body.physicalAssessment,
    ).toBeNull();

    for (const day of [daysAgo(30), daysAgo(20), daysAgo(10), daysAgo(1)]) {
      await a.post(`/educator/students/${studentId}/assessments`, values(day));
    }
    const mirror = await s.get('/me/physical-educator');
    expect(
      mirror.body.physicalAssessment.map(
        (p: { assessedOn: string }) => p.assessedOn,
      ),
    ).toEqual([daysAgo(1), daysAgo(10), daysAgo(20)]);

    expect((await s.get('/me/nutritionist')).body).toEqual({
      hasProfessional: false,
    });
    expect((await s.get('/educator/students')).status).toBe(403);
    expect(
      (await s.get(`/educator/students/${studentId}/assessments`)).status,
    ).toBe(403);
  });

  it('IT-011 refuses anonymous callers, nutritionists and regular users on every educator route', async () => {
    const routes: Array<[string, string]> = [
      ['get', `/educator/students/${RANDOM_UUID}/assessments`],
      ['post', `/educator/students/${RANDOM_UUID}/assessments`],
      ['patch', `/educator/students/${RANDOM_UUID}/assessments/${RANDOM_UUID}`],
      [
        'delete',
        `/educator/students/${RANDOM_UUID}/assessments/${RANDOM_UUID}`,
      ],
      ['get', '/educator/assessment-declaration'],
    ];
    const server = app.getHttpServer();

    for (const [method, url] of routes) {
      const anonymous = await (
        request(server) as unknown as Record<
          string,
          (u: string) => request.Test
        >
      )[method](url);
      expect(anonymous.status).toBe(401);
    }
    for (const who of [nutritionist, regularUser]) {
      const caller = await as(who);
      expect(
        (await caller.get(`/educator/students/${RANDOM_UUID}/assessments`))
          .status,
      ).toBe(403);
      expect(
        (
          await caller.post(
            `/educator/students/${RANDOM_UUID}/assessments`,
            values(daysAgo(1)),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await caller.patch(
            `/educator/students/${RANDOM_UUID}/assessments/${RANDOM_UUID}`,
            values(daysAgo(1)),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await caller.del(
            `/educator/students/${RANDOM_UUID}/assessments/${RANDOM_UUID}`,
          )
        ).status,
      ).toBe(403);
      expect(
        (await caller.get('/educator/assessment-declaration')).status,
      ).toBe(403);
    }
  });

  it('IT-012 labels each point with its own educator and mirrors the most recently linked one', async () => {
    const a = await as(educatorA);
    const b = await as(educatorB);
    const s = await as(student);
    await accept(educatorA);
    await accept(educatorB);
    const studentA = await registerStudent(educatorA, student.email, true);
    await a.post(
      `/educator/students/${studentA}/assessments`,
      values(daysAgo(6), { weightKg: 80 }),
    );
    const studentB = await registerStudent(educatorB, student.email, true);
    await b.post(
      `/educator/students/${studentB}/assessments`,
      values(daysAgo(6), { weightKg: 79 }),
    );

    const dashboard = await s.get('/progress-records/dashboard');
    const names = dashboard.body.history
      .map((p: { educatorName: string }) => p.educatorName)
      .sort();
    expect(names).toEqual(['Marina Costa', 'Thiago Ramos']);

    const mirror = await s.get('/me/physical-educator');
    expect(mirror.body.professional.name).toBe('Marina Costa');
    expect(mirror.body.physicalAssessment).toEqual([
      expect.objectContaining({ weightKg: 79 }),
    ]);
  });

  it('IT-014 orders by assessed date then creation, with same-day assessments and date changes', async () => {
    const a = await as(educatorA);
    await accept(educatorA);
    const studentId = await registerStudent(
      educatorA,
      `${RUN_TAG}-order@integration.test`,
    );
    const base = `/educator/students/${studentId}/assessments`;

    const middle = await a.post(base, values(daysAgo(10), { weightKg: 79 }));
    await a.post(base, values(daysAgo(30), { weightKg: 82 }));
    const sameDayFirst = await a.post(
      base,
      values(daysAgo(2), { weightKg: 78 }),
    );
    const sameDaySecond = await a.post(
      base,
      values(daysAgo(2), { weightKg: 77 }),
    );

    const list = await a.get(base);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([
      sameDaySecond.body.id,
      sameDayFirst.body.id,
      middle.body.id,
      expect.any(String),
    ]);
    expect(list.body.variation.weightKg).toBe(-5);
    expect(
      (await a.get(`/educator/students/${studentId}`)).body.overview.latest,
    ).toMatchObject({
      weightKg: 77,
    });

    await a.patch(
      `${base}/${middle.body.id}`,
      values(daysAgo(40), { weightKg: 79 }),
    );
    const moved = await a.get(base);
    expect(moved.body.items[3].id).toBe(middle.body.id);
    expect(moved.body.items[3].assessedOn).toBe(daysAgo(40));
  });

  it('IT-017 refuses an assessment for a student removed a moment before, with no assessment and no consent row', async () => {
    const a = await as(educatorA);
    const studentId = await registerStudent(
      educatorA,
      `${RUN_TAG}-gone@integration.test`,
    );
    expect((await a.del(`/educator/students/${studentId}`)).status).toBe(204);

    const response = await a.post(
      `/educator/students/${studentId}/assessments`,
      values(daysAgo(1), { acceptDeclaration: true }),
    );

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('student_not_found');
    expect(
      await prisma.physicalAssessment.count({ where: { clientId: studentId } }),
    ).toBe(0);
    expect(
      await prisma.featureConsent.count({ where: { userId: educatorA.id } }),
    ).toBe(0);
  });

  it('IT-018 leaves a student and an assessment equal to exactly one of two concurrent edits', async () => {
    const a = await as(educatorA);
    await accept(educatorA);
    const studentId = await registerStudent(
      educatorA,
      `${RUN_TAG}-edit@integration.test`,
    );
    const created = await a.post(
      `/educator/students/${studentId}/assessments`,
      values(daysAgo(4)),
    );
    const assessmentId = created.body.id as string;

    await Promise.all([
      a.patch(`/educator/students/${studentId}`, {
        name: 'Nome Um',
        phone: '(11) 91111-1111',
      }),
      a.patch(`/educator/students/${studentId}`, {
        name: 'Nome Dois',
        phone: '(11) 92222-2222',
      }),
    ]);
    const stored = await prisma.client.findUniqueOrThrow({
      where: { id: studentId },
    });
    const pair = `${stored.name}|${stored.phone}`;
    expect(['Nome Um|(11) 91111-1111', 'Nome Dois|(11) 92222-2222']).toContain(
      pair,
    );

    const first = values(daysAgo(4), {
      weightKg: 71,
      heightCm: 171,
      armCm: 31,
    });
    const second = values(daysAgo(4), {
      weightKg: 72,
      heightCm: 172,
      armCm: 32,
    });
    await Promise.all([
      a.patch(
        `/educator/students/${studentId}/assessments/${assessmentId}`,
        first,
      ),
      a.patch(
        `/educator/students/${studentId}/assessments/${assessmentId}`,
        second,
      ),
    ]);
    const row = await prisma.physicalAssessment.findUniqueOrThrow({
      where: { id: assessmentId },
    });
    const triple = `${row.weightKg}|${row.heightCm}|${row.armCm}`;
    expect(['71|171|31', '72|172|32']).toContain(triple);
  });
});
