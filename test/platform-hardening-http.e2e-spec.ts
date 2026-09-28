import { configureApp } from '@/config/configureApp';
import { validateEnv } from '@/config/validateEnv';
import { PrismaService } from '@/database/prisma.service';
import { PasswordHash } from '@/utils/password.hash';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { App } from 'supertest/types';

// `test/__mocks__/@nestjs/swagger.ts` auto-mocks Swagger for every e2e file,
// which would make SwaggerModule.setup a no-op and the gating untestable.
jest.unmock('@nestjs/swagger');

jest.setTimeout(90_000);

const FRONTEND_ORIGIN = 'https://app.vitaflow.test';
const FOREIGN_ORIGIN = 'https://evil.example';
const APPLICATION_SECRET = 'platform-hardening-http-application-secret';
const EMAIL_DOMAIN = '@platform-http.test';
const PASSWORD = 'StrongPass123';

// Every variable the real bootstrap requires, set explicitly so nothing is
// silently filled in from a developer's `.env` (dotenv never overrides).
function bootEnv(): NodeJS.ProcessEnv {
  return {
    JWT_SECRET: 'platform-hardening-http-jwt-secret-0123456789',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    APPLICATION_SECRET,
    STRIPE_API_KEY: 'sk_test_platform_hardening',
    APP_URL: FRONTEND_ORIGIN,
    GCP_PROJECT_ID: 'test-project',
    GCP_CLIENT_EMAIL: 'storage@test-project.iam.gserviceaccount.com',
    GCP_PRIVATE_KEY: 'test-private-key',
    GCP_BUCKET: 'test-bucket',
    MAIL_HOST: 'smtp.integration.test',
    MAIL_PORT: '465',
    MAIL_USER: 'mailer@integration.test',
    MAIL_PASS: 'mail-password',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
  };
}

function runMain(env: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', 'src/main.ts'],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...env, PORT: '0' },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
}

describe('Platform hardening — bootstrap and HTTP surface', () => {
  let devApp: INestApplication<App>;
  let prodApp: INestApplication<App>;
  let prisma: PrismaService;

  // The real AppModule, configured by the same function main.ts uses. The
  // import happens only after the environment is in place, because module
  // decorators (JwtModule.register) read it at import time.
  async function boot(nodeEnv: string): Promise<INestApplication<App>> {
    const { AppModule } =
      jest.requireActual<typeof import('@/app.module')>('@/app.module');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = module.createNestApplication<NestExpressApplication>();
    configureApp(app, { ...process.env, NODE_ENV: nodeEnv });
    await app.init();
    return app as unknown as INestApplication<App>;
  }

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    Object.assign(process.env, bootEnv());
    validateEnv();

    devApp = await boot('test');
    prodApp = await boot('production');
    prisma = devApp.get(PrismaService);
  });

  async function cleanUp() {
    await prisma.users.deleteMany({
      where: { email: { endsWith: EMAIL_DOMAIN } },
    });
  }

  afterAll(async () => {
    if (prisma) {
      await cleanUp();
    }
    await devApp?.close();
    await prodApp?.close();
  });

  describe('IT-001 fail-fast bootstrap and token expiry', () => {
    it('refuses to start with a 10-character JWT_SECRET, before Nest is created', () => {
      const result = runMain({ ...bootEnv(), JWT_SECRET: 'short-1234' });
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status).not.toBe(0);
      expect(output).toContain('JWT_SECRET must be at least 32 characters');
      expect(output).not.toContain('short-1234');
      expect(output).not.toContain('Starting Nest application');
    });

    it('refuses to start when a newly required variable is missing', () => {
      const result = runMain({ ...bootEnv(), GCP_BUCKET: '' });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'Missing required environment variable: GCP_BUCKET',
      );
    });

    it('boots with a long secret and signs in with an HS256 token expiring in 2h', async () => {
      await cleanUp();
      const email = `signin${EMAIL_DOMAIN}`;
      await prisma.users.create({
        data: {
          name: 'Platform HTTP',
          email,
          password: await devApp.get(PasswordHash).generateHash(PASSWORD),
          active: true,
        },
      });

      const before = Math.floor(Date.now() / 1000);
      const response = await request(devApp.getHttpServer())
        .post('/users/signin')
        .set('x-application-secret', APPLICATION_SECRET)
        .send({ email, password: PASSWORD })
        .expect(201);

      const token = (response.body as { accessToken: string }).accessToken;
      const [header, payload] = token
        .split('.')
        .slice(0, 2)
        .map(
          (part) =>
            JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as {
              alg?: string;
              iat?: number;
              exp?: number;
            },
        );

      expect(header.alg).toBe('HS256');
      expect(payload.exp! - payload.iat!).toBe(2 * 60 * 60);
      expect(payload.exp!).toBeGreaterThanOrEqual(before + 2 * 60 * 60);
      expect(payload.exp!).toBeLessThanOrEqual(before + 2 * 60 * 60 + 5);
    });
  });

  describe('IT-006 CORS allowlist and Swagger gating', () => {
    it('gives a disallowed Origin no CORS grant, on requests and preflights', async () => {
      const simple = await request(devApp.getHttpServer())
        .get('/plans')
        .set('Origin', FOREIGN_ORIGIN)
        .set('x-application-secret', APPLICATION_SECRET);
      const preflight = await request(devApp.getHttpServer())
        .options('/plans')
        .set('Origin', FOREIGN_ORIGIN)
        .set('Access-Control-Request-Method', 'GET');

      expect(simple.headers['access-control-allow-origin']).toBeUndefined();
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('grants the configured frontend origin', async () => {
      const preflight = await request(devApp.getHttpServer())
        .options('/plans')
        .set('Origin', FRONTEND_ORIGIN)
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);

      expect(preflight.headers['access-control-allow-origin']).toBe(
        FRONTEND_ORIGIN,
      );
    });

    it('leaves a request without an Origin header unaffected (EC-1)', async () => {
      const response = await request(devApp.getHttpServer())
        .get('/plans')
        .set('x-application-secret', APPLICATION_SECRET)
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('does not mount Swagger in a production-configured instance', async () => {
      await request(prodApp.getHttpServer()).get('/swagger/api').expect(404);
      await request(prodApp.getHttpServer())
        .get('/swagger/api-json')
        .expect(404);
    });

    it('still mounts Swagger outside production', async () => {
      await request(devApp.getHttpServer()).get('/swagger/api').expect(200);
    });
  });

  describe('IT-007 helmet headers', () => {
    it('sends the standard helmet header set on a normal response', async () => {
      const response = await request(prodApp.getHttpServer())
        .get('/plans')
        .set('x-application-secret', APPLICATION_SECRET)
        .expect(200);

      expect(response.headers).toMatchObject({
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'SAMEORIGIN',
        'referrer-policy': 'no-referrer',
        'cross-origin-opener-policy': 'same-origin',
        'x-dns-prefetch-control': 'off',
      });
      expect(response.headers['strict-transport-security']).toContain(
        'max-age=',
      );
      expect(response.headers['content-security-policy']).toContain(
        "default-src 'self'",
      );
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });
});
