import { AuthController } from '@/auth/auth.controller';
import { AuthService } from '@/auth/auth.service';
import { AuditLogger } from '@/auth/audit-logger.service';
import { DualBucketThrottlerGuard } from '@/auth/dual-bucket-throttler.guard';
import { GoogleAuthService } from '@/auth/google-auth.service';
import { PrismaService } from '@/database/prisma.service';
import { MailService } from '@/mail/mail.service';
import { OAuthIdentityRepository } from '@/repositories/auth/oauthIdentity.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

describe('POST /auth/google integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let requestIndex = 0;
  const mail = { sendEmailPassword: jest.fn().mockResolvedValue(undefined) };
  const tokens = new Map<
    string,
    { sub: string; email: string; name?: string; picture?: string }
  >();
  const googleAuth = {
    verify: jest.fn().mockImplementation((token: string) => {
      const identity = tokens.get(token);
      if (!identity) {
        return Promise.reject(new AppError('Falha ao entrar com Google.', 401));
      }
      return Promise.resolve(identity);
    }),
  };

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }])],
      controllers: [AuthController],
      providers: [
        PrismaService,
        UserRepository,
        OAuthIdentityRepository,
        AuthService,
        DualBucketThrottlerGuard,
        { provide: GoogleAuthService, useValue: googleAuth },
        {
          provide: PasswordHash,
          useValue: {
            generateHash: jest.fn().mockResolvedValue('random-hash'),
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest
              .fn()
              .mockImplementation(({ id }) => Promise.resolve(`jwt-${id}`)),
          },
        },
        {
          provide: UploadService,
          useValue: {
            getSignedUrl: jest.fn().mockResolvedValue('signed-avatar'),
          },
        },
        { provide: MailService, useValue: mail },
        {
          provide: AuditLogger,
          useValue: { log: jest.fn(), warn: jest.fn() },
        },
      ],
    }).compile();

    app = module.createNestApplication<App>();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    await app.init();
    prisma = module.get(PrismaService);
  });

  beforeEach(async () => {
    tokens.clear();
    mail.sendEmailPassword.mockClear();
    await prisma.oAuthIdentity.deleteMany();
    await prisma.users.deleteMany();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.oAuthIdentity.deleteMany();
      await prisma.users.deleteMany();
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  function identity(
    token: string,
    sub: string,
    email: string,
    name = 'Integration User',
  ) {
    tokens.set(token, { sub, email, name });
  }

  async function createUser(email: string, active: boolean) {
    return await prisma.users.create({
      data: {
        name: 'Existing User',
        email,
        password: 'existing-hash',
        active,
      },
    });
  }

  function post(token: string, ip?: string) {
    const sourceIp = ip ?? `10.250.0.${++requestIndex}`;
    return request(app.getHttpServer())
      .post('/auth/google')
      .set('x-forwarded-for', sourceIp)
      .send({ idToken: token });
  }

  it('IT-001 creates an active user and OAuth identity', async () => {
    identity('token-it-001', 'sub-it-001', 'new-it-001@task01.test');

    const response = await post('token-it-001').expect(201);

    const user = await prisma.users.findUnique({
      where: { email: 'new-it-001@task01.test' },
    });
    expect(user?.active).toBe(true);
    await expect(
      prisma.oAuthIdentity.findUnique({
        where: {
          provider_providerAccountId: {
            provider: 'google',
            providerAccountId: 'sub-it-001',
          },
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ userId: user?.id }));
    expect(response.body.accessToken).toBe(`jwt-${user?.id}`);
  });

  it('IT-002 activates and links an inactive matching user', async () => {
    const user = await createUser('inactive-it-002@task01.test', false);
    identity('token-it-002', 'sub-it-002', 'inactive-it-002@task01.test');

    await post('token-it-002').expect(201);

    await expect(
      prisma.users.findUnique({ where: { id: user.id } }),
    ).resolves.toEqual(expect.objectContaining({ active: true }));
    expect(
      await prisma.oAuthIdentity.count({ where: { userId: user.id } }),
    ).toBe(1);
  });

  it('IT-003 links an active user and sends one notification', async () => {
    const user = await createUser('active-it-003@task01.test', true);
    identity('token-it-003', 'sub-it-003', 'active-it-003@task01.test');

    await post('token-it-003').expect(201);

    expect(
      await prisma.oAuthIdentity.count({ where: { userId: user.id } }),
    ).toBe(1);
    expect(mail.sendEmailPassword).toHaveBeenCalledTimes(1);
    expect(mail.sendEmailPassword).toHaveBeenCalledWith(
      expect.any(String),
      user.email,
      expect.any(String),
      './google-linked',
      expect.any(String),
    );
  });

  it('IT-004 accepts idempotent replay with one identity and one mail', async () => {
    const user = await createUser('replay-it-004@task01.test', true);
    identity('token-it-004', 'sub-it-004', 'replay-it-004@task01.test');

    await post('token-it-004', '10.10.4.1').expect(201);
    await post('token-it-004', '10.10.4.2').expect(201);

    expect(
      await prisma.oAuthIdentity.count({ where: { userId: user.id } }),
    ).toBe(1);
    expect(mail.sendEmailPassword).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['IT-005 invalid signature', 'invalid-signature-it-005'],
    ['IT-006 wrong audience', 'wrong-audience-it-006'],
    ['IT-007 unverified email', 'unverified-email-it-007'],
  ])('%s returns 401 with no database side effects', async (_name, token) => {
    await post(token).expect(401);
    expect(await prisma.users.count()).toBe(0);
    expect(await prisma.oAuthIdentity.count()).toBe(0);
  });

  it('IT-008 resolves an existing sub before a coincidental email match', async () => {
    const userA = await createUser('account-a-it-008@task01.test', true);
    const userB = await createUser('account-b-it-008@task01.test', true);
    await prisma.oAuthIdentity.create({
      data: {
        provider: 'google',
        providerAccountId: 'sub-it-008',
        userId: userA.id,
      },
    });
    identity('token-it-008', 'sub-it-008', userB.email);

    const response = await post('token-it-008').expect(201);

    expect(response.body.id).toBe(userA.id);
    expect(
      await prisma.oAuthIdentity.count({ where: { userId: userB.id } }),
    ).toBe(0);
  });

  it('IT-009 rejects a different sub for an already linked local user', async () => {
    const user = await createUser('conflict-it-009@task01.test', true);
    await prisma.oAuthIdentity.create({
      data: {
        provider: 'google',
        providerAccountId: 'sub-x-it-009',
        userId: user.id,
      },
    });
    identity('token-it-009', 'sub-y-it-009', user.email);

    await post('token-it-009').expect(401);

    expect(
      await prisma.oAuthIdentity.count({ where: { userId: user.id } }),
    ).toBe(1);
  });

  it('IT-016 throttles the sixth repeated invalid token across changing IPs', async () => {
    for (let index = 0; index < 5; index += 1) {
      await post('invalid-token-it-016', `10.16.0.${index + 1}`).expect(401);
    }
    await post('invalid-token-it-016', '10.16.0.6').expect(429);
  });

  it('IT-018 handles concurrent first sign-in with one user and identity', async () => {
    identity('token-it-018', 'sub-it-018', 'concurrent-it-018@task01.test');

    const [first, second] = await Promise.all([
      post('token-it-018', '10.18.0.1'),
      post('token-it-018', '10.18.0.2'),
    ]);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(
      await prisma.users.count({
        where: { email: 'concurrent-it-018@task01.test' },
      }),
    ).toBe(1);
    expect(
      await prisma.oAuthIdentity.count({
        where: { providerAccountId: 'sub-it-018' },
      }),
    ).toBe(1);
  });

  it('IT-019 matches email case-insensitively without a duplicate', async () => {
    const user = await createUser('user-it-019@task01.test', true);
    identity('token-it-019', 'sub-it-019', 'USER-IT-019@TASK01.TEST');

    const response = await post('token-it-019').expect(201);

    expect(response.body.id).toBe(user.id);
    expect(
      await prisma.users.count({
        where: {
          email: { equals: user.email, mode: 'insensitive' },
        },
      }),
    ).toBe(1);
  });

  it('IT-020 never associates one Google sub with a second local account', async () => {
    const userA = await createUser('account-a-it-020@task01.test', true);
    const userB = await createUser('account-b-it-020@task01.test', true);
    await prisma.oAuthIdentity.create({
      data: {
        provider: 'google',
        providerAccountId: 'sub-it-020',
        userId: userA.id,
      },
    });
    identity('token-it-020', 'sub-it-020', userB.email);

    const response = await post('token-it-020').expect(201);

    expect(response.body.id).toBe(userA.id);
    expect(
      await prisma.oAuthIdentity.count({ where: { userId: userB.id } }),
    ).toBe(0);
  });
});
