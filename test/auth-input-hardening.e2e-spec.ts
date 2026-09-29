/**
 * Integration tests for PRD `auth-input-hardening` (task_01, backend).
 *
 * Runs the real sign-up, sign-in, activation and password-recovery
 * controllers, services, repositories, throttler guard and the app's global
 * ValidationPipe configuration against an isolated database. Only the mail
 * and upload side effects are mocked.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database
 * that has the Gratuito product (sign-up needs it).
 */
import { createValidationPipe } from '@/config/validationPipe';
import { AuditLogger } from '@/auth/auditLogger.service';
import { DualBucketThrottlerGuard } from '@/auth/dualBucketThrottler.guard';
import { PrismaService } from '@/database/prisma.service';
import { MailService } from '@/mail/mail.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { RecoverpassController } from '@/users/recoverpass/recoverpass.controller';
import { RecoverpassService } from '@/users/recoverpass/recoverpass.service';
import { SignInController } from '@/users/signin/signin.controller';
import { SignInService } from '@/users/signin/signin.service';
import { SignUpController } from '@/users/signup/signup.controller';
import { SignUpService } from '@/users/signup/signup.service';
import { UserTokenService } from '@/users/token/userToken.service';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { INestApplication } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { hash } from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';

const EMAIL_DOMAIN = '@auth-hardening.test';
const PASSWORD = 'StrongPass123';

describe('Auth and input hardening integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sendEmailPassword = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'auth-hardening-integration-jwt-secret',
          signOptions: { expiresIn: '12h' },
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
      ],
      controllers: [SignInController, SignUpController, RecoverpassController],
      providers: [
        PrismaService,
        UserRepository,
        UserTokenRepository,
        ClientsRepository,
        ProductsRepository,
        PasswordHash,
        SignInService,
        SignUpService,
        UserTokenService,
        RecoverpassService,
        DualBucketThrottlerGuard,
        {
          provide: UploadService,
          useValue: { getSignedUrl: jest.fn().mockResolvedValue(null) },
        },
        { provide: MailService, useValue: { sendEmailPassword } },
        {
          provide: AuditLogger,
          useValue: { log: jest.fn(), warn: jest.fn() },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    await app.init();
    prisma = module.get(PrismaService);
  });

  async function cleanUp() {
    const users = { email: { endsWith: EMAIL_DOMAIN } };
    await prisma.usersToken.deleteMany({ where: { user: users } });
    await prisma.users.deleteMany({ where: users });
  }

  beforeEach(async () => {
    sendEmailPassword.mockClear();
    await cleanUp();
  });

  afterAll(async () => {
    if (prisma) {
      await cleanUp();
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  function post(path: string, body: object, ip: string) {
    return request(app.getHttpServer())
      .post(path)
      .set('x-forwarded-for', ip)
      .send(body);
  }

  async function createUser(email: string, active = true) {
    return await prisma.users.create({
      data: {
        name: 'Hardening User',
        email,
        password: await hash(PASSWORD, 4),
        active,
      },
    });
  }

  // The recovery email is sent off the response path; wait for it before
  // the next test's cleanup runs.
  async function waitForRecoveryEmail() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (sendEmailPassword.mock.calls.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('recovery email was never sent');
  }

  const signUpBody = (email: string) => ({
    name: 'Hardening User',
    email,
    password: PASSWORD,
    checkPassword: PASSWORD,
    termsAccepted: true,
    healthDataConsent: true,
  });

  describe('whitelisting (US-001)', () => {
    it('IT-001 rejects a sign-up with an undeclared field and stores nothing', async () => {
      const email = `it-001${EMAIL_DOMAIN}`;

      const response = await post(
        '/users/signup',
        { ...signUpBody(email), active: true },
        '10.9.1.1',
      ).expect(400);

      expect(response.body.message).toContain(
        'property active should not exist',
      );
      await expect(prisma.users.count({ where: { email } })).resolves.toBe(0);
    });
  });

  describe('normalized email lookup (US-002)', () => {
    it('IT-003 signs up with a padded mixed-case email and signs in with the normalized form', async () => {
      await post(
        '/users/signup',
        signUpBody(`  IT-003.Mixed${EMAIL_DOMAIN.toUpperCase()} `),
        '10.9.3.1',
      ).expect(201);

      const normalized = `it-003.mixed${EMAIL_DOMAIN}`;
      const stored = await prisma.users.findFirstOrThrow({
        where: { email: normalized },
      });
      await prisma.users.update({
        where: { id: stored.id },
        data: { active: true },
      });

      const response = await post(
        '/users/signin',
        { email: normalized, password: PASSWORD },
        '10.9.3.2',
      ).expect(201);
      expect(response.body.id).toBe(stored.id);
    });

    it('rejects a malformed email and a 73-character password with 400', async () => {
      await post(
        '/users/signup',
        signUpBody('not-an-email'),
        '10.9.3.3',
      ).expect(400);

      const longPassword = 'Aa1' + 'a'.repeat(70);
      await post(
        '/users/signup',
        {
          ...signUpBody(`it-003-long${EMAIL_DOMAIN}`),
          password: longPassword,
          checkPassword: longPassword,
        },
        '10.9.3.4',
      ).expect(400);
    });

    it('still signs in an account stored with mixed case before normalization', async () => {
      const legacy = await createUser(`Legacy.Case${EMAIL_DOMAIN}`);

      const response = await post(
        '/users/signin',
        { email: `legacy.case${EMAIL_DOMAIN}`, password: PASSWORD },
        '10.9.3.5',
      ).expect(201);

      expect(response.body.id).toBe(legacy.id);
    });

    it('treats LIKE wildcards in the email literally', async () => {
      await createUser(`axb${EMAIL_DOMAIN}`);

      const response = await post(
        '/users/signin',
        { email: `a_b${EMAIL_DOMAIN}`, password: PASSWORD },
        '10.9.3.6',
      ).expect(401);

      expect(response.body.message).toBe('Usuário não autorizado.');
    });
  });

  describe('rate limiting on account-recovery routes (US-003)', () => {
    async function expectThrottledAfterFive(
      path: string,
      body: (index: number) => object,
      okStatus: number,
      ip: string,
    ) {
      for (let index = 0; index < 5; index += 1) {
        await post(path, body(index), ip).expect(okStatus);
      }
      await post(path, body(5), ip).expect(429);
    }

    it('IT-004 throttles the sixth activation request from one IP', async () => {
      await expectThrottledAfterFive(
        '/users/activate',
        (index) => ({ token: `unknown-token-${index}` }),
        400,
        '10.9.4.1',
      );
    });

    it('IT-005 throttles the sixth recovery request from one IP', async () => {
      await expectThrottledAfterFive(
        '/users/recoverpass',
        (index) => ({ email: `it-005-${index}${EMAIL_DOMAIN}` }),
        201,
        '10.9.5.1',
      );
    });

    it('IT-006 throttles the sixth new-password request from one IP', async () => {
      await expectThrottledAfterFive(
        '/users/newpassword',
        (index) => ({
          token: `unknown-token-${index}`,
          password: PASSWORD,
          checkPassword: PASSWORD,
        }),
        400,
        '10.9.6.1',
      );
    });

    it('EC-1 throttles each IP independently', async () => {
      for (let index = 0; index < 6; index += 1) {
        await post('/users/activate', { token: 'x' }, '10.9.7.1');
      }

      await post('/users/activate', { token: 'x' }, '10.9.7.2').expect(400);
    });
  });

  describe('no account enumeration (US-004)', () => {
    it('IT-007 answers recovery for a real and a fabricated email identically', async () => {
      await createUser(`it-007-real${EMAIL_DOMAIN}`);

      const real = await post(
        '/users/recoverpass',
        { email: `it-007-real${EMAIL_DOMAIN}` },
        '10.9.8.1',
      );
      const fabricated = await post(
        '/users/recoverpass',
        { email: `it-007-nobody${EMAIL_DOMAIN}` },
        '10.9.8.2',
      );

      expect(fabricated.status).toBe(real.status);
      expect(fabricated.body).toEqual(real.body);
      expect(fabricated.text).toBe(real.text);

      await waitForRecoveryEmail();
      expect(sendEmailPassword).toHaveBeenCalledTimes(1);
      expect(sendEmailPassword.mock.calls[0][1]).toBe(
        `it-007-real${EMAIL_DOMAIN}`,
      );
    });

    it('does not reveal an inactive account to a caller without its password', async () => {
      await createUser(`inactive${EMAIL_DOMAIN}`, false);

      const inactive = await post(
        '/users/signin',
        { email: `inactive${EMAIL_DOMAIN}`, password: 'WrongPass123' },
        '10.9.9.1',
      ).expect(401);
      const missing = await post(
        '/users/signin',
        { email: `missing${EMAIL_DOMAIN}`, password: 'WrongPass123' },
        '10.9.9.2',
      ).expect(401);

      expect(inactive.body).toEqual(missing.body);
    });
  });
});
