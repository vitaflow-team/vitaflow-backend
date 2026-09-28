import { configureApp } from '@/config/configureApp';
import { validateEnv } from '@/config/validateEnv';
import { PrismaService } from '@/database/prisma.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { StripeVerification } from '@/utils/stripeVerification';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

// The OpenAPI document is part of what IT-003 checks, so the e2e-wide
// Swagger auto-mock (`test/__mocks__/@nestjs/swagger.ts`) is lifted here.
jest.unmock('@nestjs/swagger');

jest.setTimeout(90_000);

const APPLICATION_SECRET = 'standards-enforcement-application-secret';
const EMAIL_DOMAIN = '@standards-enforcement.test';
const STRIPE_PRICE_ID = `price_standards_enforcement_${Date.now()}`;
const PRODUCT_NAME = 'Standards enforcement plan';
const PRODUCT_GROUP_NAME = 'Standards enforcement group';

// Every variable the real bootstrap requires, set explicitly so nothing is
// silently filled in from a developer's `.env` (dotenv never overrides).
function bootEnv(): NodeJS.ProcessEnv {
  return {
    JWT_SECRET: 'standards-enforcement-jwt-secret-0123456789',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    APPLICATION_SECRET,
    STRIPE_API_KEY: 'sk_test_standards_enforcement',
    APP_URL: 'https://app.vitaflow.test',
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

type OpenApiOperation = {
  summary?: string;
  responses: Record<
    string,
    { content?: Record<string, { schema?: unknown }> } | undefined
  >;
};
type OpenApiDocument = {
  paths: Record<string, Record<string, OpenApiOperation>>;
};

describe('Standards enforcement — HTTP layer (IT-001 to IT-005)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  const verifySubscriptionWithStripe = jest.fn();
  let productId: string;
  let sequence = 0;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    Object.assign(process.env, bootEnv());
    validateEnv();

    // Imported only after the environment is in place, because module
    // decorators (JwtModule.register) read it at import time.
    const { AppModule } =
      jest.requireActual<typeof import('@/app.module')>('@/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StripeVerification)
      .useValue({ verifySubscriptionWithStripe })
      .compile();
    const nestApp = module.createNestApplication<NestExpressApplication>();
    configureApp(nestApp, { ...process.env, NODE_ENV: 'test' });
    await nestApp.init();
    app = nestApp as unknown as INestApplication<App>;

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

    const group = await prisma.productGroup.create({
      data: { name: PRODUCT_GROUP_NAME },
    });
    const product = await prisma.product.create({
      data: {
        name: PRODUCT_NAME,
        price: 19.9,
        groupId: group.id,
        stripeId: STRIPE_PRICE_ID,
      },
    });
    productId = product.id;
  });

  afterAll(async () => {
    if (prisma) {
      const users = await prisma.users.findMany({
        where: { email: { endsWith: EMAIL_DOMAIN } },
        select: { id: true },
      });
      const ids = users.map((user) => user.id);
      await prisma.client.deleteMany({
        where: { professionalId: { in: ids } },
      });
      await prisma.userAddress.deleteMany({ where: { userId: { in: ids } } });
      await prisma.users.deleteMany({ where: { id: { in: ids } } });
      // By name, so a run that crashed before this point is cleaned up too.
      await prisma.product.deleteMany({ where: { name: PRODUCT_NAME } });
      await prisma.productGroup.deleteMany({
        where: { name: PRODUCT_GROUP_NAME },
      });
    }
    await app?.close();
  });

  async function createUser(
    overrides: Partial<Users> = {},
  ): Promise<{ user: Users; token: string }> {
    sequence += 1;
    const user = await prisma.users.create({
      data: {
        name: `Standards ${sequence}`,
        email: `user-${sequence}-${Date.now()}${EMAIL_DOMAIN}`,
        password: 'not-used-by-these-tests',
        active: true,
        ...overrides,
      },
    });
    const token = await jwtService.signAsync({
      id: user.id,
      email: user.email,
    });
    return { user, token };
  }

  function call(method: 'get' | 'post' | 'patch', path: string) {
    return request(app.getHttpServer())
      [method](path)
      .set('x-application-secret', APPLICATION_SECRET);
  }

  describe('IT-001 POST /profile for a user that no longer exists', () => {
    it('answers 404, not 402', async () => {
      const { user, token } = await createUser();
      // AuthGuard has already resolved the caller; the account then
      // disappears before the service reads it (e.g. a concurrent delete).
      // Every module registers its own UserRepository, hence the prototype.
      const spy = jest
        .spyOn(UserRepository.prototype, 'getUserProfile')
        .mockResolvedValueOnce(null);

      const response = await call('post', '/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: user.name,
          addressLine1: 'Av. Paulista, 1000',
          district: 'Bela Vista',
          city: 'São Paulo',
          region: 'SP',
          postalCode: '01310-000',
        });

      spy.mockRestore();
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        message: 'Usuário não encontrado.',
      });
    });
  });

  describe('IT-002 POST /clients conflicts', () => {
    const clientBody = (email: string) => ({
      name: 'Client',
      phone: '(11) 98888-7777',
      email,
      birthDate: '1990-05-20',
    });

    it('answers 409 for a client the professional already registered', async () => {
      const { token } = await createUser();
      const email = `client-dup${EMAIL_DOMAIN}`;

      await call('post', '/clients')
        .set('Authorization', `Bearer ${token}`)
        .send(clientBody(email))
        .expect(201);
      const response = await call('post', '/clients')
        .set('Authorization', `Bearer ${token}`)
        .send(clientBody(email));

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        message: 'Cliente já cadastrado para o profissional.',
      });
    });

    it("answers 409 for an update that takes another client's email", async () => {
      const { token } = await createUser();
      const first = await call('post', '/clients')
        .set('Authorization', `Bearer ${token}`)
        .send(clientBody(`client-a${EMAIL_DOMAIN}`))
        .expect(201);
      await call('post', '/clients')
        .set('Authorization', `Bearer ${token}`)
        .send(clientBody(`client-b${EMAIL_DOMAIN}`))
        .expect(201);

      const response = await call('post', '/clients')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...clientBody(`client-b${EMAIL_DOMAIN}`),
          id: (first.body as { id: string }).id,
        });

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        message: 'Cliente cadastrado com outro ID.',
      });
    });
  });

  describe('IT-003 OpenAPI document', () => {
    let document: OpenApiDocument;

    beforeAll(async () => {
      const response = await call('get', '/swagger/api-json').expect(200);
      document = response.body as OpenApiDocument;
    });

    function successSchema(path: string, method: string): unknown {
      const operation = document.paths[path]?.[method];
      const success = Object.entries(operation?.responses ?? {}).find(
        ([status]) => status.startsWith('2'),
      )?.[1];
      return success?.content?.['application/json']?.schema;
    }

    it.each([
      ['/products/{id}', 'get'],
      ['/products', 'get'],
      ['/plans', 'get'],
      ['/users/signin', 'post'],
      ['/users/signup', 'post'],
      ['/users/activate', 'post'],
      ['/users/recoverpass', 'post'],
      ['/users/newpassword', 'post'],
      ['/auth/google', 'post'],
      ['/profile', 'post'],
      ['/profile', 'get'],
      ['/clients', 'post'],
      ['/clients', 'get'],
      ['/clients/{id}', 'get'],
      ['/users/subscription', 'get'],
      ['/users/subscription', 'patch'],
      ['/users/subscription/sync', 'patch'],
      ['/progress-records/dashboard', 'get'],
      ['/progress-records/latest', 'get'],
      ['/progress-records', 'post'],
      ['/progress-records/{id}', 'patch'],
    ])('documents a response schema for %s %s', (path, method) => {
      expect(successSchema(path, method)).toBeDefined();
    });

    it('documents DELETE /profile as 204 and 404', () => {
      const responses = document.paths['/profile']?.delete?.responses ?? {};
      expect(Object.keys(responses)).toEqual(
        expect.arrayContaining(['204', '404']),
      );
    });

    it('documents the corrected status codes and no 402 anywhere', () => {
      expect(document.paths['/profile']?.get?.responses).toHaveProperty('404');
      expect(document.paths['/profile']?.post?.responses).toHaveProperty('404');
      expect(document.paths['/clients']?.post?.responses).toHaveProperty('409');
      for (const operations of Object.values(document.paths)) {
        for (const operation of Object.values(operations)) {
          expect(operation.responses).not.toHaveProperty('402');
        }
      }
    });

    it('gives every operation a summary', () => {
      for (const [path, operations] of Object.entries(document.paths)) {
        for (const [method, operation] of Object.entries(operations)) {
          expect({ path, method, summary: operation.summary }).toEqual({
            path,
            method,
            summary: expect.any(String),
          });
        }
      }
    });
  });

  describe('IT-004 authenticated subscription routes (SubscriptionController)', () => {
    it('GET /users/subscription returns the caller state and requires a JWT', async () => {
      const { token } = await createUser({
        stripeCustomerId: `cus_get_${Date.now()}`,
        subscriptionStatus: 'active',
      });

      await call('get', '/users/subscription').expect(401);
      const response = await call('get', '/users/subscription')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toMatchObject({
        subscriptionStatus: 'active',
        autoRenew: true,
      });
    });

    it('PATCH /users/subscription updates the caller and requires a JWT', async () => {
      const { user, token } = await createUser();
      const customerId = `cus_patch_${Date.now()}`;
      const subscriptionId = `sub_patch_${Date.now()}`;
      verifySubscriptionWithStripe.mockResolvedValueOnce({
        status: 'active',
        priceId: STRIPE_PRICE_ID,
        customerId,
        belongsToUser: true,
      });
      const body = {
        productId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        subscriptionStatus: 'active',
      };

      await call('patch', '/users/subscription').send(body).expect(401);
      const response = await call('patch', '/users/subscription')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(200);

      expect(response.body).toMatchObject({
        id: user.id,
        productId,
        subscriptionStatus: 'active',
      });
      expect(verifySubscriptionWithStripe).toHaveBeenCalledWith(
        subscriptionId,
        user.id,
      );
    });
  });

  describe('IT-005 webhook sync (SubscriptionSyncController)', () => {
    it('PATCH /users/subscription/sync works with the secret alone, no JWT', async () => {
      const customerId = `cus_sync_${Date.now()}`;
      const { user } = await createUser({ stripeCustomerId: customerId });

      const response = await call('patch', '/users/subscription/sync')
        .send({
          stripeCustomerId: customerId,
          stripePriceId: STRIPE_PRICE_ID,
          stripeSubscriptionId: `sub_sync_${Date.now()}`,
          subscriptionStatus: 'active',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        id: user.id,
        productId,
        subscriptionStatus: 'active',
      });
    });

    it('still rejects a call without the application secret', async () => {
      await request(app.getHttpServer())
        .patch('/users/subscription/sync')
        .send({
          stripeCustomerId: 'cus_no_secret',
          subscriptionStatus: 'active',
        })
        .expect(403);
    });
  });
});
