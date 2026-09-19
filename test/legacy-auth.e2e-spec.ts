import { AuditLogger } from '@/auth/audit-logger.service';
import { AuthGuard } from '@/auth/auth.guard';
import { DualBucketThrottlerGuard } from '@/auth/dual-bucket-throttler.guard';
import { PrismaService } from '@/database/prisma.service';
import { MailService } from '@/mail/mail.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { SignInController } from '@/users/signin/signin.controller';
import { SignInService } from '@/users/signin/signin.service';
import { SignUpController } from '@/users/signup/signup.controller';
import { SignUpService } from '@/users/signup/signup.service';
import {
  Controller,
  Get,
  INestApplication,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { hash } from 'bcrypt';
import { spawnSync } from 'child_process';
import request from 'supertest';
import { App } from 'supertest/types';

@Controller('task-02-protected')
class ProtectedController {
  @Get()
  @UseGuards(AuthGuard)
  getProtected() {
    return { ok: true };
  }
}

describe('Legacy authentication integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  const jwtSecret = 'task-02-integration-jwt-secret';

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = jwtSecret;

    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: jwtSecret,
          signOptions: { expiresIn: '12h' },
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
      ],
      controllers: [SignInController, SignUpController, ProtectedController],
      providers: [
        PrismaService,
        UserRepository,
        UserTokenRepository,
        ClientsRepository,
        PasswordHash,
        SignInService,
        SignUpService,
        AuthGuard,
        DualBucketThrottlerGuard,
        {
          provide: UploadService,
          useValue: { getSignedUrl: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: MailService,
          useValue: {
            sendEmailPassword: jest.fn().mockResolvedValue(undefined),
          },
        },
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
    jwtService = module.get(JwtService);
  });

  beforeEach(async () => {
    await prisma.oAuthIdentity.deleteMany();
    await prisma.usersToken.deleteMany();
    await prisma.users.deleteMany();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.oAuthIdentity.deleteMany();
      await prisma.usersToken.deleteMany();
      await prisma.users.deleteMany();
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function createUser(email: string, password: string, active = true) {
    return await prisma.users.create({
      data: {
        name: 'Task 02 User',
        email,
        password: await hash(password, 4),
        active,
      },
    });
  }

  function signin(body: Record<string, unknown>, ip: string) {
    return request(app.getHttpServer())
      .post('/users/signin')
      .set('x-forwarded-for', ip)
      .send(body);
  }

  it('IT-010 rejects the legacy socialLogin bypass for an active user', async () => {
    const user = await createUser('it-010@task02.test', 'correct-password');

    const response = await signin(
      { email: user.email, password: 'wrong', socialLogin: true },
      '10.2.10.1',
    ).expect(401);

    expect(response.body.message).toBe('Usuário não autorizado.');
  });

  it('IT-011 rejects an unknown legacy request with the same generic message', async () => {
    const user = await createUser('comparison-it-011@task02.test', 'correct');
    const known = await signin(
      { email: user.email, password: 'wrong', socialLogin: true },
      '10.2.11.1',
    ).expect(401);
    const unknown = await signin(
      {
        email: 'unknown-it-011@task02.test',
        password: 'anything',
        socialLogin: true,
      },
      '10.2.11.2',
    ).expect(401);

    expect(unknown.body.message).toBe(known.body.message);
  });

  it('IT-012 signs in an active user with the correct password', async () => {
    const user = await createUser('it-012@task02.test', 'correct-password');

    const response = await signin(
      { email: user.email, password: 'correct-password' },
      '10.2.12.1',
    ).expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({ id: user.id, accessToken: expect.any(String) }),
    );
  });

  it('IT-013 returns 401 when the JWT user was deleted', async () => {
    const user = await createUser('it-013@task02.test', 'password');
    const token = await jwtService.signAsync({
      id: user.id,
      email: user.email,
    });
    await prisma.users.delete({ where: { id: user.id } });

    await request(app.getHttpServer())
      .get('/task-02-protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('IT-014 returns 401 when the JWT email no longer matches', async () => {
    const user = await createUser('it-014-old@task02.test', 'password');
    const token = await jwtService.signAsync({
      id: user.id,
      email: user.email,
    });
    await prisma.users.update({
      where: { id: user.id },
      data: { email: 'it-014-new@task02.test' },
    });

    await request(app.getHttpServer())
      .get('/task-02-protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('IT-015 throttles the sixth signin request from one IP', async () => {
    for (let index = 0; index < 5; index += 1) {
      await signin(
        { email: `it-015-${index}@task02.test`, password: 'wrong' },
        '10.2.15.1',
      ).expect(401);
    }
    await signin(
      { email: 'it-015-6@task02.test', password: 'wrong' },
      '10.2.15.1',
    ).expect(429);
  });

  it('IT-021 keeps password signin working for a Google-linked account', async () => {
    const user = await createUser('it-021@task02.test', 'correct-password');
    await prisma.oAuthIdentity.create({
      data: {
        provider: 'google',
        providerAccountId: 'sub-it-021',
        userId: user.id,
      },
    });

    const response = await signin(
      { email: user.email, password: 'correct-password' },
      '10.2.21.1',
    ).expect(201);

    expect(response.body.id).toBe(user.id);
  });

  it('IT-022 throttles the sixth signup request from one IP', async () => {
    for (let index = 0; index < 5; index += 1) {
      await request(app.getHttpServer())
        .post('/users/signup')
        .set('x-forwarded-for', '10.2.22.1')
        .send({})
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/users/signup')
      .set('x-forwarded-for', '10.2.22.1')
      .send({})
      .expect(429);
  });
});

describe('Backend boot validation integration', () => {
  it('IT-023 fails startup and names a missing Google client secret', () => {
    const env = {
      ...process.env,
      JWT_SECRET: 'integration-jwt-secret',
      DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
      APPLICATION_SECRET: 'integration-application-secret',
      GOOGLE_CLIENT_ID: 'configured-client-id',
    };
    delete env.GOOGLE_CLIENT_SECRET;

    const result = spawnSync(
      process.execPath,
      [
        '-r',
        'ts-node/register',
        '-r',
        'tsconfig-paths/register',
        'src/main.ts',
      ],
      { cwd: process.cwd(), env, encoding: 'utf8', timeout: 30_000 },
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'GOOGLE_CLIENT_SECRET',
    );
  });
});
