/**
 * Integration tests for PRD `educator-billing`, task 1: the professional's
 * gateway account (connect, replace, disconnect) against a real migrated
 * database and the fake Asaas server. Only the gateway is faked.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { createHash } from 'crypto';
import { BillingModule } from '@/billing/billing.module';
import { hashWebhookToken } from '@/billing/shared/credentials';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { ConfigModule } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BillingAccountStatus,
  ProductTier,
  ProductType,
  Users,
  Prisma,
} from '@prisma/client';
import request from 'supertest';
import { FAKE_KEYS, FakeAsaasServer } from './support/fakeAsaasServer';

jest.setTimeout(120_000);

const RUN_TAG = `billacc-${Date.now()}`;
const JWT_SECRET =
  process.env.JWT_SECRET ?? 'billing-integration-jwt-secret-0123456789';
const fake = new FakeAsaasServer();

describe('Billing account (integration, IT-002, IT-015)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let groupId: string;
  let premiumEducator: Users;
  let otherPremiumEducator: Users;
  let standardEducator: Users;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.BILLING_ENCRYPTION_KEY =
      process.env.BILLING_ENCRYPTION_KEY ??
      Buffer.alloc(32, 9).toString('base64');
    process.env.API_PUBLIC_URL = 'https://api.vitaflow.test';
    await fake.start();
    process.env.ASAAS_BASE_URL = fake.baseUrl;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), BillingModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwt = moduleFixture.get(JwtService, { strict: false });

    const group = await prisma.productGroup.create({
      data: {
        name: `${RUN_TAG} group`,
        products: {
          create: [
            {
              name: `${RUN_TAG} premium`,
              price: 59.9,
              tier: ProductTier.PREMIUM,
              type: ProductType.PHYSICAL_EDUCATOR,
            },
            {
              name: `${RUN_TAG} standard`,
              price: 59.9,
              tier: ProductTier.STANDARD,
              type: ProductType.PHYSICAL_EDUCATOR,
            },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    const premium = group.products.find(
      (p) => p.tier === ProductTier.PREMIUM,
    )!.id;
    const standard = group.products.find(
      (p) => p.tier === ProductTier.STANDARD,
    )!.id;
    premiumEducator = await createUser('premium', premium);
    otherPremiumEducator = await createUser('premium-two', premium);
    standardEducator = await createUser('standard', standard);
  });

  afterAll(async () => {
    const ids = (
      await prisma.users.findMany({
        where: { email: { startsWith: RUN_TAG } },
        select: { id: true },
      })
    ).map((u) => u.id);
    await prisma.invoice.deleteMany({
      where: { billingAccount: { userId: { in: ids } } },
    });
    await prisma.billingAccount.deleteMany({ where: { userId: { in: ids } } });
    await prisma.client.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
    await prisma.product.deleteMany({ where: { groupId } });
    await prisma.productGroup.deleteMany({ where: { id: groupId } });
    await prisma.$disconnect();
    await app.close();
    await fake.stop();
  });

  async function createUser(label: string, productId: string): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Educator ${label}`,
        email: `${RUN_TAG}-${label}-${Math.random().toString(36).slice(2, 7)}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId,
        subscriptionStatus: 'active',
      },
    });
  }

  async function as(target: Users) {
    const token = await jwt.signAsync(
      { id: target.id, email: target.email },
      { secret: JWT_SECRET },
    );
    const auth = `Bearer ${token}`;
    const server = app.getHttpServer();
    return {
      get: () =>
        request(server).get('/billing/account').set('Authorization', auth),
      put: (apiKey: string) =>
        request(server)
          .put('/billing/account')
          .set('Authorization', auth)
          .send({ apiKey }),
      delete: () =>
        request(server).delete('/billing/account').set('Authorization', auth),
    };
  }

  it('IT-002 connects, stores the key encrypted with the token hash, registers the webhook, and returns no key', async () => {
    const caller = await as(premiumEducator);
    const response = await caller.put(FAKE_KEYS.valid);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      premium: true,
      connected: true,
      status: 'CONNECTED',
      accountName: 'Conta Teste Sandbox',
    });
    expect(JSON.stringify(response.body)).not.toContain(FAKE_KEYS.valid);

    const row = await prisma.billingAccount.findFirst({
      where: {
        userId: premiumEducator.id,
        status: BillingAccountStatus.ACTIVE,
      },
    });
    expect(row).not.toBeNull();
    expect(row!.apiKeyEncrypted).not.toContain(FAKE_KEYS.valid);
    expect(row!.apiKeyFingerprint).toBe(
      createHash('sha256').update(FAKE_KEYS.valid).digest('hex'),
    );

    const hookRegistration = fake.requests
      .filter((r) => r.method === 'POST' && r.path === '/webhooks')
      .at(-1)!;
    const authToken = hookRegistration.body!.authToken as string;
    expect(hashWebhookToken(authToken)).toBe(row!.webhookTokenHash);
  });

  it('IT-002 a rejected key stores nothing', async () => {
    const before = await prisma.billingAccount.count({
      where: { userId: otherPremiumEducator.id },
    });
    const response = await (
      await as(otherPremiumEducator)
    ).put(FAKE_KEYS.revoked);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('gateway_auth_failed');
    expect(
      await prisma.billingAccount.count({
        where: { userId: otherPremiumEducator.id },
      }),
    ).toBe(before);
  });

  it('IT-002 the same key on a second professional answers 409 account_key_in_use', async () => {
    const response = await (
      await as(otherPremiumEducator)
    ).put(FAKE_KEYS.valid);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('account_key_in_use');
  });

  it('IT-002 a standard plan cannot connect', async () => {
    const response = await (await as(standardEducator)).put(FAKE_KEYS.valid);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('premium_required');
  });

  it('IT-002 replacing marks the previous account replaced and keeps its key', async () => {
    const caller = await as(premiumEducator);
    const first = await prisma.billingAccount.findFirst({
      where: {
        userId: premiumEducator.id,
        status: BillingAccountStatus.ACTIVE,
      },
    });
    const response = await caller.put(FAKE_KEYS.valid);
    expect(response.status).toBe(200);

    const previous = await prisma.billingAccount.findUnique({
      where: { id: first!.id },
    });
    expect(previous!.status).toBe(BillingAccountStatus.REPLACED);
    expect(previous!.apiKeyEncrypted).not.toBeNull();
    expect(
      await prisma.billingAccount.count({
        where: {
          userId: premiumEducator.id,
          status: BillingAccountStatus.ACTIVE,
        },
      }),
    ).toBe(1);
  });

  it('IT-002 disconnecting removes the webhook and the key; a second call succeeds', async () => {
    const caller = await as(premiumEducator);
    const active = await prisma.billingAccount.findFirst({
      where: {
        userId: premiumEducator.id,
        status: BillingAccountStatus.ACTIVE,
      },
    });

    expect((await caller.delete()).status).toBe(204);
    expect(
      fake.requests.some(
        (r) =>
          r.method === 'DELETE' && r.path === `/webhooks/${active!.webhookId}`,
      ),
    ).toBe(true);

    const row = await prisma.billingAccount.findUnique({
      where: { id: active!.id },
    });
    expect(row!.status).toBe(BillingAccountStatus.DISCONNECTED);
    expect(row!.apiKeyEncrypted).toBeNull();
    expect((await (await as(premiumEducator)).get()).body.connected).toBe(
      false,
    );
    expect((await caller.delete()).status).toBe(204);
  });

  it('IT-015 the partial unique indexes hold: one active account per professional and one live invoice per student and month', async () => {
    const indexes = await prisma.$queryRaw<
      Array<{ indexname: string; indexdef: string }>
    >`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN ('BillingAccount_one_active_per_user_key', 'Invoice_student_month_not_canceled_key')`;
    expect(indexes.map((i) => i.indexname).sort()).toEqual([
      'BillingAccount_one_active_per_user_key',
      'Invoice_student_month_not_canceled_key',
    ]);
    expect(indexes.every((i) => /WHERE/.test(i.indexdef))).toBe(true);

    const account = await prisma.billingAccount.create({
      data: {
        userId: premiumEducator.id,
        provider: 'ASAAS',
        status: BillingAccountStatus.ACTIVE,
        accountName: 'Teste',
        apiKeyEncrypted: 'x',
        apiKeyFingerprint: `fp-${RUN_TAG}-a`,
        webhookTokenHash: `hash-${RUN_TAG}-a`,
      },
    });
    await expect(
      prisma.billingAccount.create({
        data: {
          userId: premiumEducator.id,
          provider: 'ASAAS',
          status: BillingAccountStatus.ACTIVE,
          accountName: 'Teste',
          apiKeyEncrypted: 'x',
          apiKeyFingerprint: `fp-${RUN_TAG}-b`,
          webhookTokenHash: `hash-${RUN_TAG}-b`,
        },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    const client = await prisma.client.create({
      data: {
        name: 'Aluno',
        phone: '11999990000',
        email: `${RUN_TAG}-aluno@integration.test`,
        professionalId: premiumEducator.id,
      },
    });
    const invoice = (status: 'PENDING' | 'CANCELED') => ({
      clientId: client.id,
      billingAccountId: account.id,
      competenceYear: 2026,
      competenceMonth: 10,
      amountCents: 5000,
      dueDate: new Date('2026-10-20'),
      status,
    });
    await prisma.invoice.create({ data: invoice('PENDING') });
    await expect(
      prisma.invoice.create({ data: invoice('PENDING') }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    await expect(
      prisma.invoice.create({ data: invoice('CANCELED') }),
    ).resolves.toBeDefined();
  });
});
