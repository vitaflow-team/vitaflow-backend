import { AuditLogger } from '@/auth/auditLogger.service';
import { DualBucketThrottlerGuard } from '@/auth/dualBucketThrottler.guard';
import { createValidationPipe } from '@/config/validationPipe';
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
import { hashToken, UserTokenService } from '@/users/token/userToken.service';
import { UploadService } from '@/utils/upload.service';
import { PasswordHash } from '@/utils/password.hash';
import { INestApplication } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { TokenType } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const EMAIL_DOMAIN = '@platform-tokens.test';
const PASSWORD = 'StrongPass123';
const NEW_PASSWORD = 'NewStrongPass456';

describe('Dedicated activation and recovery tokens (US-002)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ipSequence = 0;
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
        JwtModule.register({ secret: 'platform-tokens-integration-secret' }),
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
        RecoverpassService,
        UserTokenService,
        DualBucketThrottlerGuard,
        {
          provide: UploadService,
          useValue: { getSignedUrl: jest.fn().mockResolvedValue(null) },
        },
        { provide: MailService, useValue: { sendEmailPassword } },
        { provide: AuditLogger, useValue: { log: jest.fn(), warn: jest.fn() } },
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

  // A fresh client IP per request keeps the per-IP throttle out of the way.
  function post(path: string, body: object) {
    ipSequence += 1;
    return request(app.getHttpServer())
      .post(path)
      .set(
        'x-forwarded-for',
        `10.20.${Math.floor(ipSequence / 250)}.${ipSequence % 250}`,
      )
      .send(body);
  }

  // The raw token only exists in the emailed link. Recovery mail is sent off
  // the response path, so wait for it to arrive.
  async function tokenFromEmail(sent = 1): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (sendEmailPassword.mock.calls.length >= sent) {
        const link = sendEmailPassword.mock.calls[sent - 1][4] as string;
        return link.split('token=')[1];
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('token email was never sent');
  }

  async function signUp(email: string): Promise<{ id: string; raw: string }> {
    const response = await post('/users/signup', {
      name: 'Token User',
      email,
      password: PASSWORD,
      checkPassword: PASSWORD,
      termsAccepted: true,
      healthDataConsent: true,
    }).expect(201);
    return {
      id: (response.body as { id: string }).id,
      raw: await tokenFromEmail(),
    };
  }

  async function requestRecovery(email: string, sent = 1): Promise<string> {
    await post('/users/recoverpass', { email }).expect(201);
    return await tokenFromEmail(sent);
  }

  function changePassword(token: string, password = NEW_PASSWORD) {
    return post('/users/newpassword', {
      token,
      password,
      checkPassword: password,
    });
  }

  function signIn(email: string, password: string) {
    return post('/users/signin', { email, password });
  }

  async function tokensOf(userID: string) {
    return await prisma.usersToken.findMany({ where: { userID } });
  }

  describe('IT-002 full activation and recovery flow', () => {
    it('activates with the emailed token, storing only its hash', async () => {
      const email = `it-002-activate${EMAIL_DOMAIN}`;
      const { id, raw } = await signUp(email);

      const [stored] = await tokensOf(id);
      expect(stored).toMatchObject({
        type: TokenType.ACTIVATION,
        tokenHash: hashToken(raw),
      });
      expect(stored.id).not.toBe(raw);
      expect(JSON.stringify(stored)).not.toContain(raw);
      const ttl = stored.expiresAt.getTime() - stored.createdAt.getTime();
      expect(Math.round(ttl / 60_000)).toBe(120);

      const activated = await post('/users/activate', { token: raw }).expect(
        201,
      );
      expect(activated.body).toMatchObject({ id, active: true });
      await expect(tokensOf(id)).resolves.toHaveLength(0);
    });

    it('changes the password with the emailed recovery token', async () => {
      const email = `it-002-recover${EMAIL_DOMAIN}`;
      const { id, raw: activation } = await signUp(email);
      await post('/users/activate', { token: activation }).expect(201);

      const raw = await requestRecovery(email, 2);
      const [stored] = await tokensOf(id);
      expect(stored).toMatchObject({
        type: TokenType.RECOVERY,
        tokenHash: hashToken(raw),
      });
      const ttl = stored.expiresAt.getTime() - stored.createdAt.getTime();
      expect(Math.round(ttl / 60_000)).toBe(180);

      await changePassword(raw).expect(201);

      await signIn(email, NEW_PASSWORD).expect(201);
      await expect(tokensOf(id)).resolves.toHaveLength(0);
    });

    it('keeps one live recovery token per user (EC-1)', async () => {
      const email = `it-002-reissue${EMAIL_DOMAIN}`;
      const { id, raw: activation } = await signUp(email);
      await post('/users/activate', { token: activation }).expect(201);

      const first = await requestRecovery(email, 2);
      const second = await requestRecovery(email, 3);

      await expect(tokensOf(id)).resolves.toHaveLength(1);
      await changePassword(first).expect(400);
      await changePassword(second).expect(201);
    });
  });

  describe('IT-003 a token works exactly once', () => {
    it('rejects a second activation with the same token', async () => {
      const { raw } = await signUp(`it-003-activate${EMAIL_DOMAIN}`);

      await post('/users/activate', { token: raw }).expect(201);
      await post('/users/activate', { token: raw }).expect(400);
    });

    it('rejects a second password change with the same token', async () => {
      const email = `it-003-recover${EMAIL_DOMAIN}`;
      const { raw: activation } = await signUp(email);
      await post('/users/activate', { token: activation }).expect(201);
      const raw = await requestRecovery(email, 2);

      await changePassword(raw).expect(201);
      await changePassword(raw, 'ThirdStrongPass789').expect(400);

      await signIn(email, NEW_PASSWORD).expect(201);
      await signIn(email, 'ThirdStrongPass789').expect(401);
    });

    it('lets only one of two concurrent uses apply', async () => {
      const email = `it-003-race${EMAIL_DOMAIN}`;
      const { raw: activation } = await signUp(email);
      await post('/users/activate', { token: activation }).expect(201);
      const raw = await requestRecovery(email, 2);

      const statuses = (
        await Promise.all([
          changePassword(raw),
          changePassword(raw, 'ThirdStrongPass789'),
        ])
      ).map((response) => response.status);

      expect(statuses.sort()).toEqual([201, 400]);
    });
  });

  describe('IT-004 an expired token fails and is removed', () => {
    async function expire(userID: string) {
      await prisma.usersToken.updateMany({
        where: { userID },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    }

    it('rejects an expired activation token', async () => {
      const { id, raw } = await signUp(`it-004-activate${EMAIL_DOMAIN}`);
      await expire(id);

      await post('/users/activate', { token: raw }).expect(400);

      await expect(tokensOf(id)).resolves.toHaveLength(0);
      const user = await prisma.users.findUniqueOrThrow({ where: { id } });
      expect(user.active).toBe(false);
    });

    it('rejects an expired recovery token', async () => {
      const email = `it-004-recover${EMAIL_DOMAIN}`;
      const { id, raw: activation } = await signUp(email);
      await post('/users/activate', { token: activation }).expect(201);
      const raw = await requestRecovery(email, 2);
      await expire(id);

      await changePassword(raw).expect(400);

      await expect(tokensOf(id)).resolves.toHaveLength(0);
      await signIn(email, PASSWORD).expect(201);
    });
  });
});
