/**
 * Integration/E2E tests for PRD `churn-risk-alert-independent` (task_01, backend).
 *
 * Runs the real IndependentChurnRiskController/EducatorDashboardController/
 * NutritionistDashboardController, ChurnRiskEvaluationService.evaluateProfessional,
 * ChurnRiskCronService's new loop, their repositories, AuthGuard,
 * PhysicalEducatorGuard, NutritionistGuard against an isolated database. Only
 * MailService is faked (no real e-mail send). Never touches the existing
 * Academia churn-risk path's own seed/behavior.
 *
 * IT-001..IT-007 and E2E-001..E2E-008 (`_tests.md`) both exercise this same
 * real HTTP/service surface, per this project's convention (see
 * churn-risk-alert.e2e-spec.ts) — there is no separate browser-E2E layer.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database —
 * specifically, one with the churn-risk-alert-independent migration
 * (new ChurnRiskReason values, Users.independentChurnRiskBaselineAt) applied.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { NutritionistGuard } from '@/common/guards/nutritionist.guard';
import { PrismaService } from '@/database/prisma.service';
import { MailService } from '@/mail/mail.service';
import { IndependentChurnRiskController } from '@/academia/churn-risk/independentChurnRisk.controller';
import { ChurnRiskCronService } from '@/academia/churn-risk/churnRiskCron.service';
import { ChurnRiskEvaluationService } from '@/academia/churn-risk/churnRiskEvaluation.service';
import { ChurnRiskEpisodeRepository } from '@/repositories/academia/churnRiskEpisode.repository';
import { AcademiaRepository } from '@/repositories/academia/academia.repository';
import { CheckInRepository } from '@/repositories/academia/checkIn.repository';
import { StudentAccessPlanRepository } from '@/repositories/academia/studentAccessPlan.repository';
import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { InvoicesRepository } from '@/repositories/billing/invoices.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { MealsRepository } from '@/repositories/food-diary/meals.repository';
import { WaterLogRepository } from '@/repositories/food-diary/waterLog.repository';
import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { MealPlansRepository } from '@/repositories/meal-plans/mealPlans.repository';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { EducatorDashboardController } from '@/educator-students/dashboard/educatorDashboard.controller';
import { EducatorDashboardService } from '@/educator-students/dashboard/educatorDashboard.service';
import { NutritionistDashboardController } from '@/nutritionist-patients/dashboard/nutritionistDashboard.controller';
import { NutritionistDashboardService } from '@/nutritionist-patients/dashboard/nutritionistDashboard.service';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BillingAccountStatus,
  BillingProvider,
  Client,
  FixedSessionStatus,
  InvoiceStatus,
  ProductType,
  SessionType,
  Users,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `crai-${Date.now()}`;
const DAY_MS = 24 * 60 * 60 * 1000;

describe('Churn-risk alert for independent professionals — integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let evaluation: ChurnRiskEvaluationService;
  let cron: ChurnRiskCronService;
  let groupId: string;
  let educatorA: Users;
  let nutriA: Users;
  let now: Date;
  const jwtSecret = 'crai-integration-jwt-secret';
  const sendNotificationEmail = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = jwtSecret;
    now = new Date();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: jwtSecret })],
      controllers: [
        IndependentChurnRiskController,
        EducatorDashboardController,
        NutritionistDashboardController,
      ],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        AcademiaRepository,
        CheckInRepository,
        StudentAccessPlanRepository,
        ChurnRiskEpisodeRepository,
        FixedTimesRepository,
        MealsRepository,
        WaterLogRepository,
        BillingAccountRepository,
        InvoicesRepository,
        MealPlansRepository,
        MeasurementRecordsRepository,
        NotificationsRepository,
        NotificationsService,
        ChurnRiskEvaluationService,
        ChurnRiskCronService,
        EducatorDashboardService,
        NutritionistDashboardService,
        { provide: Clock, useValue: { now: () => now } },
        AuthGuard,
        PhysicalEducatorGuard,
        NutritionistGuard,
        { provide: MailService, useValue: { sendNotificationEmail } },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);
    evaluation = moduleFixture.get(ChurnRiskEvaluationService);
    cron = moduleFixture.get(ChurnRiskCronService);

    await seed();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    const professionalIds = [educatorA.id, nutriA.id];
    await prisma.churnRiskEpisode.deleteMany({
      where: { client: { professionalId: { in: professionalIds } } },
    });
    await prisma.notification.deleteMany({
      where: { userId: { in: professionalIds } },
    });
    await prisma.invoice.deleteMany({
      where: { billingAccount: { userId: { in: professionalIds } } },
    });
    await prisma.billingAccount.deleteMany({
      where: { userId: { in: professionalIds } },
    });
    await prisma.fixedSession.deleteMany({
      where: { professionalId: { in: professionalIds } },
    });
    const privateClients = await prisma.client.findMany({
      where: { professionalId: { in: professionalIds }, academiaId: null },
      select: { id: true, userId: true },
    });
    const clientUserIds = privateClients
      .map((c) => c.userId)
      .filter((id): id is string => !!id);
    await prisma.meal.deleteMany({ where: { userId: { in: clientUserIds } } });
    await prisma.waterLog.deleteMany({
      where: { userId: { in: clientUserIds } },
    });
    await prisma.client.deleteMany({
      where: { professionalId: { in: professionalIds }, academiaId: null },
    });
    await prisma.users.deleteMany({
      where: { id: { in: [...professionalIds, ...clientUserIds] } },
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
              name: `${RUN_TAG} nutritionist`,
              price: 10,
              type: ProductType.NUTRITIONIST,
            },
            { name: `${RUN_TAG} user`, price: 0, type: ProductType.USER },
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
    nutriA = await createUser('nutri-a', { productId: nutriProduct.id });
  }

  async function createUser(
    label: string,
    extra: Record<string, unknown>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `CRAI ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        ...extra,
      },
    });
  }

  async function createPrivateClient(
    professionalId: string,
    label: string,
    overrides: { userId?: string | null; createdAt?: Date } = {},
  ): Promise<Client> {
    return await prisma.client.create({
      data: {
        name: `Cliente ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        phone: '',
        professional: { connect: { id: professionalId } },
        userId: overrides.userId ?? null,
        createdAt: overrides.createdAt,
      },
    });
  }

  async function bearerForUser(target: Users): Promise<string> {
    const token = await jwtService.signAsync({
      id: target.id,
      email: target.email,
    });
    return `Bearer ${token}`;
  }

  async function asUser(target: Users) {
    const auth = await bearerForUser(target);
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set('Authorization', auth),
      post: (url: string) =>
        request(server).post(url).set('Authorization', auth),
    };
  }

  async function markIndependentBaselined(
    professionalId: string,
    at: Date,
  ): Promise<void> {
    await prisma.users.update({
      where: { id: professionalId },
      data: { independentChurnRiskBaselineAt: at },
    });
  }

  it('IT-001/E2E-001 Educador Físico: a student with no session in 10+ days gets an episode and a notification', async () => {
    await markIndependentBaselined(
      educatorA.id,
      new Date(now.getTime() - 20 * DAY_MS),
    );
    const student = await createPrivateClient(educatorA.id, 'it001', {
      createdAt: new Date(now.getTime() - 30 * DAY_MS),
    });
    await prisma.fixedSession.create({
      data: {
        clientId: student.id,
        professionalId: educatorA.id,
        startAt: new Date(now.getTime() - 14 * DAY_MS),
        endAt: new Date(now.getTime() - 14 * DAY_MS + 60 * 60 * 1000),
        status: FixedSessionStatus.SCHEDULED,
        type: SessionType.PRESENCIAL,
      },
    });

    const before = await prisma.notification.count({
      where: { userId: educatorA.id, category: 'CHURN_RISK_ALERT' },
    });
    const result = await evaluation.evaluateProfessional(
      educatorA.id,
      ProductType.PHYSICAL_EDUCATOR,
      now,
    );
    const after = await prisma.notification.count({
      where: { userId: educatorA.id, category: 'CHURN_RISK_ALERT' },
    });

    expect(result.notified).toBe(true);
    expect(after - before).toBe(1);
    const episode = await prisma.churnRiskEpisode.findFirst({
      where: { clientId: student.id, reason: 'NO_CONTACT', endedAt: null },
    });
    expect(episode).not.toBeNull();

    const educator = await asUser(educatorA);
    const dashboard = await educator.get('/educator/students/dashboard');
    expect(
      dashboard.body.noContactAlerts.some(
        (entry: { clientId: string }) => entry.clientId === student.id,
      ),
    ).toBe(true);
  });

  it('IT-002/E2E-002 Nutricionista: a patient with no diary entry in 10+ days (old relationship) gets an episode and a notification', async () => {
    await markIndependentBaselined(
      nutriA.id,
      new Date(now.getTime() - 20 * DAY_MS),
    );
    const patientUser = await createUser('patient-it002', {
      productId: (
        await prisma.product.findFirstOrThrow({
          where: { groupId, type: ProductType.USER },
        })
      ).id,
    });
    const patient = await createPrivateClient(nutriA.id, 'it002', {
      userId: patientUser.id,
      createdAt: new Date(now.getTime() - 30 * DAY_MS),
    });

    const before = await prisma.notification.count({
      where: { userId: nutriA.id, category: 'CHURN_RISK_ALERT' },
    });
    const result = await evaluation.evaluateProfessional(
      nutriA.id,
      ProductType.NUTRITIONIST,
      now,
    );
    const after = await prisma.notification.count({
      where: { userId: nutriA.id, category: 'CHURN_RISK_ALERT' },
    });

    expect(result.notified).toBe(true);
    expect(after - before).toBe(1);
    const episode = await prisma.churnRiskEpisode.findFirst({
      where: { clientId: patient.id, reason: 'NO_DIARY_ENTRY', endedAt: null },
    });
    expect(episode).not.toBeNull();

    const nutri = await asUser(nutriA);
    const dashboard = await nutri.get('/nutritionist/patients/dashboard');
    expect(
      dashboard.body.noDiaryEntryAlerts.some(
        (entry: { clientId: string }) => entry.clientId === patient.id,
      ),
    ).toBe(true);

    await prisma.client.delete({ where: { id: patient.id } });
    await prisma.users.delete({ where: { id: patientUser.id } });
  });

  it('IT-003/E2E-003/E2E-004 overdue payment: alone and combined with inactivity in the same run', async () => {
    await markIndependentBaselined(
      educatorA.id,
      new Date(now.getTime() - 20 * DAY_MS),
    );
    const account = await prisma.billingAccount.create({
      data: {
        userId: educatorA.id,
        provider: BillingProvider.ASAAS,
        status: BillingAccountStatus.ACTIVE,
        accountName: `${RUN_TAG} account`,
        apiKeyFingerprint: `${RUN_TAG}-fp`,
        webhookTokenHash: `${RUN_TAG}-wh`,
      },
    });
    const student = await createPrivateClient(educatorA.id, 'it003', {
      createdAt: new Date(now.getTime() - 30 * DAY_MS),
    });
    await prisma.invoice.create({
      data: {
        clientId: student.id,
        billingAccountId: account.id,
        competenceYear: 2026,
        competenceMonth: 11,
        amountCents: 10_000,
        dueDate: new Date(now.getTime() - 5 * DAY_MS),
        status: InvoiceStatus.OVERDUE,
      },
    });
    // Also inactive on contact — same evaluation, same run, one combined
    // notification.
    await prisma.fixedSession.create({
      data: {
        clientId: student.id,
        professionalId: educatorA.id,
        startAt: new Date(now.getTime() - 14 * DAY_MS),
        endAt: new Date(now.getTime() - 14 * DAY_MS + 60 * 60 * 1000),
        status: FixedSessionStatus.SCHEDULED,
        type: SessionType.PRESENCIAL,
      },
    });

    const before = await prisma.notification.count({
      where: { userId: educatorA.id, category: 'CHURN_RISK_ALERT' },
    });
    const result = await evaluation.evaluateProfessional(
      educatorA.id,
      ProductType.PHYSICAL_EDUCATOR,
      now,
    );
    const after = await prisma.notification.count({
      where: { userId: educatorA.id, category: 'CHURN_RISK_ALERT' },
    });

    expect(result.notified).toBe(true);
    expect(after - before).toBe(1); // combined, not two

    const episodes = await prisma.churnRiskEpisode.findMany({
      where: { clientId: student.id, endedAt: null },
    });
    expect(episodes.map((e) => e.reason).sort()).toEqual(
      ['NO_CONTACT', 'OVERDUE_PAYMENT'].sort(),
    );
  });

  it('IT-004 the shared dismiss endpoint closes every open episode for a client and refuses a different professional', async () => {
    await markIndependentBaselined(
      educatorA.id,
      new Date(now.getTime() - 20 * DAY_MS),
    );
    const student = await createPrivateClient(educatorA.id, 'it004', {
      createdAt: new Date(now.getTime() - 30 * DAY_MS),
    });
    await evaluation.evaluateProfessional(
      educatorA.id,
      ProductType.PHYSICAL_EDUCATOR,
      now,
    );
    const openBefore = await prisma.churnRiskEpisode.count({
      where: { clientId: student.id, endedAt: null },
    });
    expect(openBefore).toBeGreaterThan(0);

    const otherEducator = await createUser('other-educator-it004', {
      productId: (
        await prisma.product.findFirstOrThrow({
          where: { groupId, type: ProductType.PHYSICAL_EDUCATOR },
        })
      ).id,
    });
    const other = await asUser(otherEducator);
    const refused = await other.post(
      `/professionals/clients/${student.id}/churn-risk/dismiss`,
    );
    expect(refused.status).toBe(404);

    const owner = await asUser(educatorA);
    const dismissed = await owner.post(
      `/professionals/clients/${student.id}/churn-risk/dismiss`,
    );
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.dismissed).toBeGreaterThan(0);

    await prisma.users.delete({ where: { id: otherEducator.id } });
  });

  it('IT-005 one professional failing never prevents another from being evaluated in the same cron run', async () => {
    await markIndependentBaselined(
      educatorA.id,
      new Date(now.getTime() - 20 * DAY_MS),
    );
    await markIndependentBaselined(
      nutriA.id,
      new Date(now.getTime() - 20 * DAY_MS),
    );
    const patientUser = await createUser('patient-it005', {
      productId: (
        await prisma.product.findFirstOrThrow({
          where: { groupId, type: ProductType.USER },
        })
      ).id,
    });
    const patient = await createPrivateClient(nutriA.id, 'it005', {
      userId: patientUser.id,
      createdAt: new Date(now.getTime() - 30 * DAY_MS),
    });

    // Spies on the real service's own method, forcing a failure for one
    // professional only, while the other still runs through the real
    // implementation — the same fault-isolation shape
    // churn-risk-alert.e2e-spec.ts's own IT-004 already exercises for
    // academias.
    const original: (
      professionalId: string,
      productType:
        | typeof ProductType.PHYSICAL_EDUCATOR
        | typeof ProductType.NUTRITIONIST,
      now: Date,
    ) => Promise<{ notified: boolean }> =
      evaluation.evaluateProfessional.bind(evaluation);
    const realSpy = jest
      .spyOn(evaluation, 'evaluateProfessional')
      .mockImplementation((professionalId, productType, at) => {
        if (professionalId === educatorA.id) {
          return Promise.reject(new Error('malformed educator data'));
        }
        return original(professionalId, productType, at);
      });

    const notificationsBefore = await prisma.notification.count({
      where: { userId: nutriA.id, category: 'CHURN_RISK_ALERT' },
    });
    const summary = await cron.run();
    const notificationsAfter = await prisma.notification.count({
      where: { userId: nutriA.id, category: 'CHURN_RISK_ALERT' },
    });

    expect(summary.professionalsFailed).toBeGreaterThanOrEqual(1);
    expect(notificationsAfter - notificationsBefore).toBe(1);

    realSpy.mockRestore();
    await prisma.client.delete({ where: { id: patient.id } });
    await prisma.users.delete({ where: { id: patientUser.id } });
  });

  it('IT-006/E2E-006 dismissed client drops off the dashboard, then reappears once at risk again later', async () => {
    await markIndependentBaselined(
      educatorA.id,
      new Date(now.getTime() - 20 * DAY_MS),
    );
    const student = await createPrivateClient(educatorA.id, 'it006', {
      createdAt: new Date(now.getTime() - 30 * DAY_MS),
    });
    await evaluation.evaluateProfessional(
      educatorA.id,
      ProductType.PHYSICAL_EDUCATOR,
      now,
    );

    const owner = await asUser(educatorA);
    await owner.post(`/professionals/clients/${student.id}/churn-risk/dismiss`);

    const afterDismiss = await owner.get('/educator/students/dashboard');
    expect(
      afterDismiss.body.noContactAlerts.some(
        (entry: { clientId: string }) => entry.clientId === student.id,
      ),
    ).toBe(false);

    // Recovers (new session), then relapses later — a genuinely new episode.
    await prisma.fixedSession.create({
      data: {
        clientId: student.id,
        professionalId: educatorA.id,
        startAt: now,
        endAt: new Date(now.getTime() + 60 * 60 * 1000),
        status: FixedSessionStatus.SCHEDULED,
        type: SessionType.PRESENCIAL,
      },
    });
    await evaluation.evaluateProfessional(
      educatorA.id,
      ProductType.PHYSICAL_EDUCATOR,
      now,
    );
    const relapseNow = new Date(now.getTime() + 15 * DAY_MS);
    await evaluation.evaluateProfessional(
      educatorA.id,
      ProductType.PHYSICAL_EDUCATOR,
      relapseNow,
    );

    const relapsedEpisode = await prisma.churnRiskEpisode.findFirst({
      where: { clientId: student.id, reason: 'NO_CONTACT', endedAt: null },
    });
    expect(relapsedEpisode).not.toBeNull();
    expect(relapsedEpisode?.dismissedAt).toBeNull();
  });

  it('IT-007/E2E-007 a professional’s first-ever evaluation is silent; the second evaluation notifies normally', async () => {
    const freshEducator = await createUser('fresh-educator', {
      productId: (
        await prisma.product.findFirstOrThrow({
          where: { groupId, type: ProductType.PHYSICAL_EDUCATOR },
        })
      ).id,
    });
    const student = await createPrivateClient(freshEducator.id, 'it007', {
      createdAt: new Date(now.getTime() - 30 * DAY_MS),
    });
    await prisma.fixedSession.create({
      data: {
        clientId: student.id,
        professionalId: freshEducator.id,
        startAt: new Date(now.getTime() - 14 * DAY_MS),
        endAt: new Date(now.getTime() - 14 * DAY_MS + 60 * 60 * 1000),
        status: FixedSessionStatus.SCHEDULED,
        type: SessionType.PRESENCIAL,
      },
    });

    const first = await evaluation.evaluateProfessional(
      freshEducator.id,
      ProductType.PHYSICAL_EDUCATOR,
      now,
    );
    expect(first.notified).toBe(false);
    const baselineAt = (
      await prisma.users.findUniqueOrThrow({ where: { id: freshEducator.id } })
    ).independentChurnRiskBaselineAt;
    expect(baselineAt).not.toBeNull();

    // A second, later student newly goes inactive — notifies normally.
    const student2 = await createPrivateClient(freshEducator.id, 'it007b', {
      createdAt: new Date(now.getTime() - 30 * DAY_MS),
    });
    await prisma.fixedSession.create({
      data: {
        clientId: student2.id,
        professionalId: freshEducator.id,
        startAt: new Date(now.getTime() - 14 * DAY_MS),
        endAt: new Date(now.getTime() - 14 * DAY_MS + 60 * 60 * 1000),
        status: FixedSessionStatus.SCHEDULED,
        type: SessionType.PRESENCIAL,
      },
    });
    const second = await evaluation.evaluateProfessional(
      freshEducator.id,
      ProductType.PHYSICAL_EDUCATOR,
      new Date(now.getTime() + DAY_MS),
    );
    expect(second.notified).toBe(true);

    await prisma.churnRiskEpisode.deleteMany({
      where: { clientId: { in: [student.id, student2.id] } },
    });
    await prisma.fixedSession.deleteMany({
      where: { clientId: { in: [student.id, student2.id] } },
    });
    await prisma.client.deleteMany({
      where: { id: { in: [student.id, student2.id] } },
    });
    await prisma.users.delete({ where: { id: freshEducator.id } });
  });

  it('E2E-005 an episode that recovers and relapses is notified again, never silently once-only forever', async () => {
    await markIndependentBaselined(
      educatorA.id,
      new Date(now.getTime() - 20 * DAY_MS),
    );
    const student = await createPrivateClient(educatorA.id, 'e2e005', {
      createdAt: new Date(now.getTime() - 30 * DAY_MS),
    });

    await evaluation.evaluateProfessional(
      educatorA.id,
      ProductType.PHYSICAL_EDUCATOR,
      now,
    );
    const afterFirst = await prisma.notification.count({
      where: { userId: educatorA.id, category: 'CHURN_RISK_ALERT' },
    });

    await prisma.fixedSession.create({
      data: {
        clientId: student.id,
        professionalId: educatorA.id,
        startAt: now,
        endAt: new Date(now.getTime() + 60 * 60 * 1000),
        status: FixedSessionStatus.SCHEDULED,
        type: SessionType.PRESENCIAL,
      },
    });
    const relapseNow = new Date(now.getTime() + 15 * DAY_MS);
    await evaluation.evaluateProfessional(
      educatorA.id,
      ProductType.PHYSICAL_EDUCATOR,
      relapseNow,
    );
    const afterRelapse = await prisma.notification.count({
      where: { userId: educatorA.id, category: 'CHURN_RISK_ALERT' },
    });

    expect(afterRelapse).toBeGreaterThan(afterFirst);
  });

  it('E2E-008 a brand-new relationship is not flagged before the grace period, then becomes eligible afterward', async () => {
    await markIndependentBaselined(
      nutriA.id,
      new Date(now.getTime() - 20 * DAY_MS),
    );
    const patientUser = await createUser('patient-e2e008', {
      productId: (
        await prisma.product.findFirstOrThrow({
          where: { groupId, type: ProductType.USER },
        })
      ).id,
    });
    const patient = await createPrivateClient(nutriA.id, 'e2e008', {
      userId: patientUser.id,
      createdAt: new Date(now.getTime() - 3 * DAY_MS),
    });

    const early = await evaluation.evaluateProfessional(
      nutriA.id,
      ProductType.NUTRITIONIST,
      now,
    );
    expect(early.notified).toBe(false);
    const earlyEpisode = await prisma.churnRiskEpisode.findFirst({
      where: { clientId: patient.id, reason: 'NO_DIARY_ENTRY', endedAt: null },
    });
    expect(earlyEpisode).toBeNull();

    const later = new Date(now.getTime() + 10 * DAY_MS);
    await evaluation.evaluateProfessional(
      nutriA.id,
      ProductType.NUTRITIONIST,
      later,
    );
    const laterEpisode = await prisma.churnRiskEpisode.findFirst({
      where: { clientId: patient.id, reason: 'NO_DIARY_ENTRY', endedAt: null },
    });
    expect(laterEpisode).not.toBeNull();

    await prisma.client.delete({ where: { id: patient.id } });
    await prisma.users.delete({ where: { id: patientUser.id } });
  });
});
