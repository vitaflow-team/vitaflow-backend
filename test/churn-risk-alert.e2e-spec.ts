/**
 * Integration tests for PRD `churn-risk-alert` (task_01, backend).
 *
 * Runs the real ChurnRiskController/EngajamentoController, ChurnRiskEvaluation
 * Service, ChurnRiskCronService, their repositories, AuthGuard, AcademiaOwnerGuard
 * and the app's global ValidationPipe against an isolated database. Only
 * MailService is faked (no real e-mail send).
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { MailService } from '@/mail/mail.service';
import { ChurnRiskController } from '@/academia/churn-risk/churnRisk.controller';
import { ChurnRiskCronService } from '@/academia/churn-risk/churnRiskCron.service';
import { ChurnRiskEvaluationService } from '@/academia/churn-risk/churnRiskEvaluation.service';
import { EngajamentoController } from '@/academia/engajamento/engajamento.controller';
import { EngajamentoService } from '@/academia/engajamento/engajamento.service';
import { AcademiaRepository } from '@/repositories/academia/academia.repository';
import { CheckInRepository } from '@/repositories/academia/checkIn.repository';
import { ChurnRiskEpisodeRepository } from '@/repositories/academia/churnRiskEpisode.repository';
import { StudentAccessPlanRepository } from '@/repositories/academia/studentAccessPlan.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Academia,
  ChurnRiskReason,
  Client,
  ProductType,
  Users,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `churn-risk-${Date.now()}`;
const DAY_MS = 24 * 60 * 60 * 1000;

describe('Churn-risk alert integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let academiaRepository: AcademiaRepository;
  let cron: ChurnRiskCronService;
  let evaluation: ChurnRiskEvaluationService;
  let groupId: string;
  let academiaA: Academia;
  let academiaB: Academia;
  let ownerA: Users;
  let ownerB: Users;
  let now: Date;
  const jwtSecret = 'churn-risk-integration-jwt-secret';
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
      controllers: [ChurnRiskController, EngajamentoController],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        CheckInRepository,
        StudentAccessPlanRepository,
        AcademiaRepository,
        ChurnRiskEpisodeRepository,
        NotificationsRepository,
        NotificationsService,
        EngajamentoService,
        ChurnRiskEvaluationService,
        ChurnRiskCronService,
        { provide: Clock, useValue: { now: () => now } },
        AuthGuard,
        AcademiaOwnerGuard,
        { provide: MailService, useValue: { sendNotificationEmail } },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);
    academiaRepository = moduleFixture.get(AcademiaRepository);
    cron = moduleFixture.get(ChurnRiskCronService);
    evaluation = moduleFixture.get(ChurnRiskEvaluationService);

    await seed();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await prisma.churnRiskEpisode.deleteMany({
      where: { client: { academiaId: { in: [academiaA.id, academiaB.id] } } },
    });
    await prisma.notification.deleteMany({
      where: { userId: { in: [ownerA.id, ownerB.id] } },
    });
    await prisma.checkIn.deleteMany({
      where: { client: { academiaId: { in: [academiaA.id, academiaB.id] } } },
    });
    await prisma.studentAccessPlan.deleteMany({
      where: { client: { academiaId: { in: [academiaA.id, academiaB.id] } } },
    });
    await prisma.academiaAccessPlan.deleteMany({
      where: { academiaId: { in: [academiaA.id, academiaB.id] } },
    });
    await prisma.client.deleteMany({
      where: { academiaId: { in: [academiaA.id, academiaB.id] } },
    });
    await prisma.academia.deleteMany({
      where: { id: { in: [academiaA.id, academiaB.id] } },
    });
    await prisma.users.deleteMany({
      where: { id: { in: [ownerA.id, ownerB.id] } },
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
              name: `${RUN_TAG} academia`,
              price: 10,
              type: ProductType.ACADEMIA,
            },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    const academiaProduct = group.products[0];

    academiaA = await prisma.academia.create({
      data: { name: `${RUN_TAG} Academia A` },
    });
    academiaB = await prisma.academia.create({
      data: { name: `${RUN_TAG} Academia B` },
    });

    ownerA = await createUser('owner-a', {
      productId: academiaProduct.id,
      academiaId: academiaA.id,
    });
    ownerB = await createUser('owner-b', {
      productId: academiaProduct.id,
      academiaId: academiaB.id,
    });
  }

  async function createUser(
    label: string,
    extra: Record<string, unknown>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Churn Risk ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        ...extra,
      },
    });
  }

  async function createClient(
    academia: Academia,
    label: string,
  ): Promise<Client> {
    return await prisma.client.create({
      data: {
        name: `Aluno ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        phone: '',
        academia: { connect: { id: academia.id } },
      },
    });
  }

  async function markBaselined(academia: Academia, at: Date): Promise<void> {
    await academiaRepository.markChurnRiskBaselined(academia.id, at);
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

  describe('IT-001 dismiss endpoint guard stack', () => {
    it('401 with no token', async () => {
      const response = await request(app.getHttpServer()).post(
        '/academia/churn-risk/any-client-id/dismiss',
      );
      expect(response.status).toBe(401);
    });

    it("404 for a client not owned by the caller's academia", async () => {
      const clientB = await createClient(academiaB, 'guard-b');
      const owner = await asUser(ownerA);

      const response = await owner.post(
        `/academia/churn-risk/${clientB.id}/dismiss`,
      );

      expect(response.status).toBe(404);
    });

    it('200 for the owning academia, including the no-open-episode no-op case', async () => {
      const client = await createClient(academiaA, 'guard-noop');
      const owner = await asUser(ownerA);

      const response = await owner.post(
        `/academia/churn-risk/${client.id}/dismiss`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ dismissed: 0 });
    });
  });

  describe('IT-002 dismiss effect', () => {
    it('removes the student from the dashboard and suppresses further notification for the dismissed episode, while a later genuinely new episode still notifies', async () => {
      await markBaselined(academiaA, new Date(now.getTime() - 10 * DAY_MS));
      const client = await createClient(academiaA, 'it002');
      await prisma.checkIn.create({
        data: {
          clientId: client.id,
          source: 'SELF',
          registeredByStaffId: null,
          planValidAtCheckIn: true,
          createdAt: new Date(now.getTime() - 14 * DAY_MS),
        },
      });

      await evaluation.evaluateAcademia(academiaA.id, now);
      const notificationsAfterFirstRun = await prisma.notification.count({
        where: { userId: ownerA.id, category: 'CHURN_RISK_ALERT' },
      });
      expect(notificationsAfterFirstRun).toBe(1);

      const owner = await asUser(ownerA);
      const dismissResponse = await owner.post(
        `/academia/churn-risk/${client.id}/dismiss`,
      );
      expect(dismissResponse.status).toBe(200);
      expect(dismissResponse.body.dismissed).toBe(1);

      const dashboard = await owner.get('/academia/engajamento');
      expect(
        dashboard.body.atRisk.some(
          (student: { clientId: string }) => student.clientId === client.id,
        ),
      ).toBe(false);

      // Still at risk, still dismissed-open: no further notification.
      await evaluation.evaluateAcademia(academiaA.id, now);
      const notificationsAfterSecondRun = await prisma.notification.count({
        where: { userId: ownerA.id, category: 'CHURN_RISK_ALERT' },
      });
      expect(notificationsAfterSecondRun).toBe(1);

      // Recovers (fresh check-in), then relapses — a genuinely new episode.
      await prisma.checkIn.create({
        data: {
          clientId: client.id,
          source: 'SELF',
          registeredByStaffId: null,
          planValidAtCheckIn: true,
          createdAt: now,
        },
      });
      await evaluation.evaluateAcademia(academiaA.id, now);
      const relapseNow = new Date(now.getTime() + 15 * DAY_MS);
      await evaluation.evaluateAcademia(academiaA.id, relapseNow);

      const notificationsAfterRelapse = await prisma.notification.count({
        where: { userId: ownerA.id, category: 'CHURN_RISK_ALERT' },
      });
      expect(notificationsAfterRelapse).toBe(2);
    });
  });

  describe('IT-003 full evaluation cycle', () => {
    it('produces the exact expected episode/notification outcome for students in each state, in one run', async () => {
      await markBaselined(academiaA, new Date(now.getTime() - 10 * DAY_MS));
      const newlyAtRisk = await createClient(academiaA, 'it003-new');
      const alreadyNotified = await createClient(academiaA, 'it003-dup');
      const relapsed = await createClient(academiaA, 'it003-relapse');
      const dismissedStudent = await createClient(academiaA, 'it003-dismiss');

      const old = new Date(now.getTime() - 14 * DAY_MS);
      await prisma.checkIn.createMany({
        data: [newlyAtRisk, alreadyNotified, relapsed, dismissedStudent].map(
          (client) => ({
            clientId: client.id,
            source: 'SELF' as const,
            registeredByStaffId: null,
            planValidAtCheckIn: true,
            createdAt: old,
          }),
        ),
      });

      await prisma.churnRiskEpisode.create({
        data: {
          clientId: alreadyNotified.id,
          reason: ChurnRiskReason.CHECK_IN_INACTIVITY,
          notifiedAt: old,
        },
      });
      await prisma.churnRiskEpisode.create({
        data: {
          clientId: relapsed.id,
          reason: ChurnRiskReason.CHECK_IN_INACTIVITY,
          notifiedAt: old,
          endedAt: new Date(now.getTime() - 1 * DAY_MS),
        },
      });
      await prisma.churnRiskEpisode.create({
        data: {
          clientId: dismissedStudent.id,
          reason: ChurnRiskReason.CHECK_IN_INACTIVITY,
          notifiedAt: old,
          dismissedAt: old,
        },
      });

      const before = await prisma.notification.count({
        where: { userId: ownerA.id, category: 'CHURN_RISK_ALERT' },
      });
      await evaluation.evaluateAcademia(academiaA.id, now);
      const after = await prisma.notification.count({
        where: { userId: ownerA.id, category: 'CHURN_RISK_ALERT' },
      });

      // newlyAtRisk + relapsed each get exactly one new notification.
      expect(after - before).toBe(2);

      const openEpisodes = await prisma.churnRiskEpisode.findMany({
        where: {
          clientId: {
            in: [
              newlyAtRisk.id,
              alreadyNotified.id,
              relapsed.id,
              dismissedStudent.id,
            ],
          },
          endedAt: null,
        },
      });
      expect(
        openEpisodes.some((episode) => episode.clientId === newlyAtRisk.id),
      ).toBe(true);
      expect(
        openEpisodes.filter((episode) => episode.clientId === relapsed.id),
      ).toHaveLength(1);
      expect(
        openEpisodes.some(
          (episode) => episode.clientId === dismissedStudent.id,
        ),
      ).toBe(true);
    });
  });

  describe('IT-004 fault isolation', () => {
    it("one academia's deliberately failing evaluation never prevents the other from being evaluated and notified in the same run", async () => {
      await markBaselined(academiaA, new Date(now.getTime() - 10 * DAY_MS));
      await markBaselined(academiaB, new Date(now.getTime() - 10 * DAY_MS));
      const failingClient = await createClient(academiaA, 'it004-fail');
      const okClient = await createClient(academiaB, 'it004-ok');
      const old = new Date(now.getTime() - 14 * DAY_MS);
      await prisma.checkIn.createMany({
        data: [
          {
            clientId: failingClient.id,
            source: 'SELF' as const,
            registeredByStaffId: null,
            planValidAtCheckIn: true,
            createdAt: old,
          },
          {
            clientId: okClient.id,
            source: 'SELF' as const,
            registeredByStaffId: null,
            planValidAtCheckIn: true,
            createdAt: old,
          },
        ],
      });

      const original: (academiaId: string) => Promise<Date | null> =
        academiaRepository.findChurnRiskBaselineAt.bind(academiaRepository);
      const spy = jest
        .spyOn(academiaRepository, 'findChurnRiskBaselineAt')
        .mockImplementation(
          (academiaId: string): Promise<Date | null> =>
            academiaId === academiaA.id
              ? Promise.reject(new Error('malformed academia data'))
              : original(academiaId),
        );

      const notificationsBeforeB = await prisma.notification.count({
        where: { userId: ownerB.id, category: 'CHURN_RISK_ALERT' },
      });
      const summary = await cron.run();
      const notificationsAfterB = await prisma.notification.count({
        where: { userId: ownerB.id, category: 'CHURN_RISK_ALERT' },
      });

      expect(summary.failed).toBeGreaterThanOrEqual(1);
      expect(notificationsAfterB - notificationsBeforeB).toBe(1);

      spy.mockRestore();
    });
  });

  describe('IT-005 baseline/launch behavior', () => {
    it("a fresh academia's first-ever evaluation sends zero notifications, records episodes for every matching student, sets churnRiskBaselineAt, and leaves the dashboard list unaffected", async () => {
      const freshAcademia = await prisma.academia.create({
        data: { name: `${RUN_TAG} Fresh` },
      });
      const freshOwner = await createUser('owner-fresh', {
        productId: (
          await prisma.product.findFirstOrThrow({
            where: { groupId, type: ProductType.ACADEMIA },
          })
        ).id,
        academiaId: freshAcademia.id,
      });
      const freshClient = await createClient(freshAcademia, 'it005');
      await prisma.checkIn.create({
        data: {
          clientId: freshClient.id,
          source: 'SELF',
          registeredByStaffId: null,
          planValidAtCheckIn: true,
          createdAt: new Date(now.getTime() - 14 * DAY_MS),
        },
      });

      const result = await evaluation.evaluateAcademia(freshAcademia.id, now);
      expect(result.notificationsSent).toBe(0);
      expect(result.newEpisodes).toBe(1);

      const baselineAt = await academiaRepository.findChurnRiskBaselineAt(
        freshAcademia.id,
      );
      expect(baselineAt).not.toBeNull();

      const owner = await asUser(freshOwner);
      const dashboard = await owner.get('/academia/engajamento');
      expect(
        dashboard.body.atRisk.some(
          (student: { clientId: string }) =>
            student.clientId === freshClient.id,
        ),
      ).toBe(true);

      await prisma.checkIn.deleteMany({ where: { clientId: freshClient.id } });
      await prisma.churnRiskEpisode.deleteMany({
        where: { clientId: freshClient.id },
      });
      await prisma.client.delete({ where: { id: freshClient.id } });
      await prisma.users.delete({ where: { id: freshOwner.id } });
      await prisma.academia.delete({ where: { id: freshAcademia.id } });
    });
  });
});
