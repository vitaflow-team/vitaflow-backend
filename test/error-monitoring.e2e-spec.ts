/**
 * Integration tests for PRD `error-monitoring` (task_01, backend).
 *
 * Runs the real ErrorMonitoringController/Service, NewIssueAlertCron,
 * AuthGuard, BackofficeGuard, AdminTierGuard and the real MailService
 * against an isolated database. `SentryGateway` is replaced by a jest.fn()
 * stub (its own unit tests already cover its HTTP boundary — this suite
 * never calls real Sentry) and MailerModule uses nodemailer's built-in
 * JSON transport (a real transport, never a real SMTP send) so
 * MailService/NewIssueAlertCron run their real code end to end.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { AdminTierGuard } from '@/common/guards/adminTier.guard';
import { BackofficeGuard } from '@/common/guards/backoffice.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { ErrorMonitoringController } from '@/error-monitoring/errorMonitoring.controller';
import { ErrorMonitoringService } from '@/error-monitoring/errorMonitoring.service';
import {
  ERROR_ALERT_EMAIL,
  SENTRY_BACKEND_PROJECT_SLUG,
  SENTRY_FRONTEND_PROJECT_SLUG,
} from '@/error-monitoring/errorMonitoring.tokens';
import { GatewayError } from '@/error-monitoring/gateway/sentry/sentryGateway';
import { SENTRY_GATEWAY } from '@/error-monitoring/gateway/sentry/sentryGateway.tokens';
import { NewIssueAlertCron } from '@/error-monitoring/newIssueAlertCron';
import { MailService } from '@/mail/mail.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { INestApplication } from '@nestjs/common';
import { MailerModule, MailerService } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { BackofficeTier, Users } from '@prisma/client';
import path from 'path';
import request from 'supertest';

jest.setTimeout(60_000);

const RUN_TAG = `error-monitoring-${Date.now()}`;

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('Error monitoring — backoffice endpoints + alert cron integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let mailerService: MailerService;
  const jwtSecret = 'error-monitoring-integration-jwt-secret';
  const createdUserIds: string[] = [];
  const listIssues = jest.fn();
  const getIssueDetail = jest.fn();

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
        MailerModule.forRoot({
          transport: { jsonTransport: true },
          defaults: { from: '"Vita Flow" <ops@vitaflow.app>' },
          template: {
            dir: path.join(__dirname, '../src/mail/templates'),
            adapter: new HandlebarsAdapter(),
          },
        }),
      ],
      controllers: [ErrorMonitoringController],
      providers: [
        PrismaService,
        UserRepository,
        ErrorMonitoringService,
        NewIssueAlertCron,
        MailService,
        AuthGuard,
        BackofficeGuard,
        AdminTierGuard,
        { provide: SENTRY_GATEWAY, useValue: { listIssues, getIssueDetail } },
        { provide: SENTRY_BACKEND_PROJECT_SLUG, useValue: 'vitaflow-backend' },
        {
          provide: SENTRY_FRONTEND_PROJECT_SLUG,
          useValue: 'vitaflow-frontend',
        },
        { provide: ERROR_ALERT_EMAIL, useValue: 'ops@vitaflow.app' },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);
    mailerService = moduleFixture.get(MailerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await prisma.users.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  async function createUser(
    label: string,
    overrides: Partial<{
      isBackoffice: boolean;
      backofficeTier: BackofficeTier | null;
    }> = {},
  ): Promise<Users> {
    const user = await prisma.users.create({
      data: {
        name: `User ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        isBackoffice: overrides.isBackoffice ?? false,
        backofficeTier: overrides.backofficeTier ?? null,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function bearerFor(user: Users): Promise<string> {
    const token = await jwtService.signAsync({
      id: user.id,
      email: user.email,
    });
    return `Bearer ${token}`;
  }

  async function asUser(user: Users) {
    const auth = await bearerFor(user);
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set('Authorization', auth),
    };
  }

  function rawIssue(overrides: Record<string, unknown> = {}) {
    return {
      id: 'issue-1',
      title: 'TypeError: boom',
      culprit: 'src/foo.ts',
      level: 'error',
      count: 1,
      firstSeen: '2026-11-01T10:00:00.000Z',
      lastSeen: '2026-11-03T10:00:00.000Z',
      status: 'unresolved',
      ...overrides,
    };
  }

  describe('GET /backoffice/error-monitoring', () => {
    it('IT-001 rejects a request with no Authorization header', async () => {
      const response = await request(app.getHttpServer()).get(
        '/backoffice/error-monitoring',
      );

      expect(response.status).toBe(401);
    });

    it('IT-002 rejects a BackofficeTier.EQUIPE staff member', async () => {
      const equipe = await asUser(
        await createUser('it002-equipe', {
          isBackoffice: true,
          backofficeTier: BackofficeTier.EQUIPE,
        }),
      );

      const response = await equipe.get('/backoffice/error-monitoring');

      // AdminTierGuard throws AppError (not CodedError) — its `reason`
      // ('not_admin_interno') is deliberately internal-only, per AppError's
      // own contract (src/utils/app.erro.ts): never serialized into the
      // client-facing response body. Only the status is observable here,
      // matching every other existing AppError-guarded route in this suite.
      expect(response.status).toBe(403);
    });

    it('IT-003 rejects a non-backoffice user', async () => {
      const plain = await asUser(await createUser('it003-plain'));

      const response = await plain.get('/backoffice/error-monitoring');

      // Same as IT-002: BackofficeGuard's AppError reason
      // ('not_backoffice') never reaches the response body.
      expect(response.status).toBe(403);
    });

    it('IT-004 returns 200 with items tagged backend and frontend for an ADMIN', async () => {
      listIssues.mockImplementation((projectSlug: string) =>
        Promise.resolve([
          rawIssue({ id: projectSlug === 'vitaflow-backend' ? 'b-1' : 'f-1' }),
        ]),
      );
      const admin = await asUser(
        await createUser('it004-admin', {
          isBackoffice: true,
          backofficeTier: BackofficeTier.ADMIN,
        }),
      );

      const response = await admin.get('/backoffice/error-monitoring');

      expect(response.status).toBe(200);
      const apps = (response.body.items as { app: string }[]).map((i) => i.app);
      expect(apps).toEqual(expect.arrayContaining(['backend', 'frontend']));
    });

    it('IT-009 returns 502 sentry_unavailable when SentryGateway fails', async () => {
      listIssues.mockRejectedValue(new GatewayError('unavailable', 'down'));
      const admin = await asUser(
        await createUser('it009-admin', {
          isBackoffice: true,
          backofficeTier: BackofficeTier.ADMIN,
        }),
      );

      const response = await admin.get('/backoffice/error-monitoring');

      expect(response.status).toBe(502);
      expect(response.body.code).toBe('sentry_unavailable');
    });
  });

  describe('GET /backoffice/error-monitoring/:app/:issueId', () => {
    it('IT-005 returns 404 issue_not_found when Sentry 404s the issue', async () => {
      getIssueDetail.mockRejectedValue(
        new GatewayError('not_found', 'missing'),
      );
      const admin = await asUser(
        await createUser('it005-admin', {
          isBackoffice: true,
          backofficeTier: BackofficeTier.ADMIN,
        }),
      );

      const response = await admin.get(
        '/backoffice/error-monitoring/backend/missing-issue',
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('issue_not_found');
    });

    it('IT-006 returns 502 sentry_unavailable when Sentry is unreachable', async () => {
      getIssueDetail.mockRejectedValue(new GatewayError('unavailable', 'down'));
      const admin = await asUser(
        await createUser('it006-admin', {
          isBackoffice: true,
          backofficeTier: BackofficeTier.ADMIN,
        }),
      );

      const response = await admin.get(
        '/backoffice/error-monitoring/backend/some-issue',
      );

      expect(response.status).toBe(502);
      expect(response.body.code).toBe('sentry_unavailable');
    });

    it('IT-008 returns 200 with the stack trace for a valid issue', async () => {
      getIssueDetail.mockResolvedValue({
        ...rawIssue(),
        stackTrace: 'at bar (foo.ts:10)',
      });
      const admin = await asUser(
        await createUser('it008-admin', {
          isBackoffice: true,
          backofficeTier: BackofficeTier.ADMIN,
        }),
      );

      const response = await admin.get(
        '/backoffice/error-monitoring/backend/issue-1',
      );

      expect(response.status).toBe(200);
      expect(response.body.stackTrace).toBe('at bar (foo.ts:10)');
    });
  });

  describe('NewIssueAlertCron', () => {
    it('IT-007 hands one e-mail to the SMTP transport, addressed to ERROR_ALERT_EMAIL, naming the failing app', async () => {
      const sendMailSpy = jest.spyOn(mailerService, 'sendMail');
      listIssues.mockImplementation((projectSlug: string) =>
        Promise.resolve(
          projectSlug === 'vitaflow-backend'
            ? [rawIssue({ id: 'cron-1' })]
            : [],
        ),
      );
      const cron = app.get(NewIssueAlertCron);

      await cron.checkForNewIssues();
      await flushMicrotasks();

      expect(sendMailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'ops@vitaflow.app',
          subject: expect.stringContaining('backend'),
        }),
      );
    });
  });
});
