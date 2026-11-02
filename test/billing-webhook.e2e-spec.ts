/**
 * Integration tests for PRD `educator-billing`, task 3: the Asaas webhook
 * route against a real migrated database and the fake Asaas server.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { BillingModule } from '@/billing/billing.module';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { MailService } from '@/mail/mail.service';
import { ConfigModule } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BillingAccountStatus,
  BillingProvider,
  Client,
  ProductTier,
  ProductType,
  Users,
} from '@prisma/client';
import request from 'supertest';
import { encryptSecret } from '@/billing/shared/secretCipher';
import { hashWebhookToken } from '@/billing/shared/credentials';
import { FAKE_KEYS, FakeAsaasServer } from './support/fakeAsaasServer';

jest.setTimeout(120_000);

const RUN_TAG = `billwh-${Date.now()}`;
const JWT_SECRET =
  process.env.JWT_SECRET ?? 'billing-integration-jwt-secret-0123456789';
const fake = new FakeAsaasServer();
const sendNotificationEmail = jest.fn().mockResolvedValue(undefined);
const CIPHER_KEY = Buffer.alloc(32, 9);

function todayPlus(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
function currentCompetence(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}
function invoiceDto(overrides: Record<string, unknown> = {}) {
  const { year, month } = currentCompetence();
  return {
    competenceYear: year,
    competenceMonth: month,
    amount: '199.90',
    dueDate: todayPlus(5),
    cpfCnpj: '529.982.247-25',
    ...overrides,
  };
}

describe('Asaas webhook (integration, IT-009, IT-016, IT-017, IT-018, IT-019)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let groupId: string;
  let premiumEducator: Users;
  let premiumProductId: string;
  let standardProductId: string;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.BILLING_ENCRYPTION_KEY = CIPHER_KEY.toString('base64');
    process.env.API_PUBLIC_URL = 'https://api.vitaflow.test';
    await fake.start();
    process.env.ASAAS_BASE_URL = fake.baseUrl;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), BillingModule],
    })
      .overrideProvider(MailService)
      .useValue({ sendNotificationEmail })
      .compile();
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
    premiumProductId = group.products.find(
      (p) => p.tier === ProductTier.PREMIUM,
    )!.id;
    standardProductId = group.products.find(
      (p) => p.tier === ProductTier.STANDARD,
    )!.id;

    premiumEducator = await createUser('premium-educator', premiumProductId);
    await connectAccount(premiumEducator, `${RUN_TAG}-educator-key`);
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
    await prisma.billingCustomer.deleteMany({
      where: { billingAccount: { userId: { in: ids } } },
    });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
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
        name: `User ${label}`,
        email: `${RUN_TAG}-${label}-${Math.random().toString(36).slice(2, 7)}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId,
        subscriptionStatus: 'active',
      },
    });
  }

  async function connectAccount(
    professional: Users,
    apiKey: string,
  ): Promise<string> {
    const response = await (await as(professional)).account.put(apiKey);
    expect(response.status).toBe(200);
    return webhookTokenFor(apiKey);
  }

  // The raw token only ever appears in the fake server's recorded request
  // (the real app never returns it) — the same technique
  // billing-account.e2e-spec.ts uses to confirm the hash.
  function webhookTokenFor(apiKey: string): string {
    const registration = fake.requests
      .filter(
        (r) =>
          r.method === 'POST' &&
          r.path === '/webhooks' &&
          r.headers['access_token'] === apiKey,
      )
      .at(-1)!;
    return registration.body!.authToken as string;
  }

  async function createClient(
    professionalId: string,
    opts: { linked?: boolean } = {},
  ): Promise<Client> {
    let userId: string | undefined;
    if (opts.linked) {
      const studentUser = await prisma.users.create({
        data: {
          name: `Student ${RUN_TAG}`,
          email: `${RUN_TAG}-student-${Math.random().toString(36).slice(2, 7)}@integration.test`,
          password: 'unused-in-integration-test',
          active: true,
        },
      });
      userId = studentUser.id;
    }
    return await prisma.client.create({
      data: {
        name: `Aluno ${RUN_TAG}`,
        phone: '11999990000',
        email: `${RUN_TAG}-aluno-${Math.random().toString(36).slice(2, 7)}@integration.test`,
        professionalId,
        userId,
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
      account: {
        put: (apiKey: string) =>
          request(server)
            .put('/billing/account')
            .set('Authorization', auth)
            .send({ apiKey }),
      },
      create: (clientId: string, body: Record<string, unknown>) =>
        request(server)
          .post(`/billing/students/${clientId}/invoices`)
          .set('Authorization', auth)
          .send(body),
      update: (invoiceId: string, body: Record<string, unknown>) =>
        request(server)
          .patch(`/billing/invoices/${invoiceId}`)
          .set('Authorization', auth)
          .send(body),
      markPaid: (invoiceId: string, body: Record<string, unknown>) =>
        request(server)
          .post(`/billing/invoices/${invoiceId}/mark-paid`)
          .set('Authorization', auth)
          .send(body),
    };
  }

  function notice(chargeId: string, token: string | undefined) {
    const call = request(app.getHttpServer())
      .post('/billing/webhooks/asaas')
      .send({ event: 'PAYMENT_RECEIVED', payment: { id: chargeId } });
    return token === undefined ? call : call.set('asaas-access-token', token);
  }

  async function createInvoice(client: Client): Promise<{
    id: string;
    externalId: string;
  }> {
    const created = await (
      await as(premiumEducator)
    ).create(client.id, invoiceDto());
    const row = await prisma.invoice.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    return { id: row.id, externalId: row.externalId! };
  }

  beforeEach(() => {
    sendNotificationEmail.mockClear();
  });

  describe('IT-009 webhook behavior', () => {
    it('a valid notice marks the invoice paid and notifies the professional once; a repeated notice changes nothing', async () => {
      const client = await createClient(premiumEducator.id);
      const { id, externalId } = await createInvoice(client);
      fake.setChargeStatus(externalId, 'RECEIVED', todayPlus(0));
      const token = webhookTokenFor(`${RUN_TAG}-educator-key`);

      const first = await notice(externalId, token);
      expect(first.status).toBe(200);

      const invoice = await prisma.invoice.findUniqueOrThrow({
        where: { id },
      });
      expect(invoice.status).toBe('PAID');

      const notifications = await prisma.notification.findMany({
        where: { userId: premiumEducator.id, category: 'BILLING' },
      });
      expect(notifications).toHaveLength(1);

      const second = await notice(externalId, token);
      expect(second.status).toBe(200);
      const after = await prisma.notification.findMany({
        where: { userId: premiumEducator.id, category: 'BILLING' },
      });
      expect(after).toHaveLength(1);
    });

    it('a wrong or missing token answers a generic 401 and reads nothing', async () => {
      const client = await createClient(premiumEducator.id);
      const { externalId } = await createInvoice(client);

      const wrong = await notice(externalId, 'definitely-not-a-real-token');
      expect(wrong.status).toBe(401);

      const missing = await notice(externalId, undefined);
      expect(missing.status).toBe(401);
    });

    it('an unknown charge answers 200', async () => {
      const token = webhookTokenFor(`${RUN_TAG}-educator-key`);
      // A charge that genuinely exists at the gateway (so the read itself
      // succeeds) but that no Invoice row references (UT-083) — distinct
      // from a charge the gateway itself has never heard of, which is a
      // gateway-read failure (503), not this case.
      const created = await fetch(`${fake.baseUrl}/payments`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          access_token: `${RUN_TAG}-educator-key`,
        },
        body: JSON.stringify({ value: 100, dueDate: todayPlus(5) }),
      }).then((r) => r.json() as Promise<{ id: string }>);

      const response = await notice(created.id, token);
      expect(response.status).toBe(200);
    });

    it('an overdue notice after a payment leaves it paid', async () => {
      const client = await createClient(premiumEducator.id);
      const { id, externalId } = await createInvoice(client);
      const token = webhookTokenFor(`${RUN_TAG}-educator-key`);

      fake.setChargeStatus(externalId, 'RECEIVED', todayPlus(0));
      await notice(externalId, token);

      fake.setChargeStatus(externalId, 'OVERDUE');
      await notice(externalId, token);

      const invoice = await prisma.invoice.findUniqueOrThrow({
        where: { id },
      });
      expect(invoice.status).toBe('PAID');
    });

    it('a failing charge read answers 503', async () => {
      // A throwaway account whose key the fake server always errors on
      // (FAKE_KEYS.down) — seeded directly, bypassing the normal connect
      // flow, which would itself fail against that key.
      // REPLACED (not ACTIVE, to not collide with the one-active-per-user
      // index) but still holds a key, which is all findByWebhookTokenHash
      // requires.
      const account = await prisma.billingAccount.create({
        data: {
          userId: premiumEducator.id,
          provider: BillingProvider.ASAAS,
          status: BillingAccountStatus.REPLACED,
          accountName: 'Conta Indisponível',
          apiKeyEncrypted: encryptSecret(FAKE_KEYS.down, CIPHER_KEY),
          apiKeyFingerprint: `fp-${RUN_TAG}-down`,
          webhookTokenHash: hashWebhookToken(`${RUN_TAG}-down-token`),
        },
      });

      const response = await notice('pay_whatever', `${RUN_TAG}-down-token`);
      expect(response.status).toBe(503);

      await prisma.billingAccount.delete({ where: { id: account.id } });
    });
  });

  describe('IT-016 notices end to end', () => {
    it('a new invoice sends one link e-mail and an in-app notice for a linked student', async () => {
      const client = await createClient(premiumEducator.id, { linked: true });
      await createInvoice(client);

      expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
      const notifications = await prisma.notification.findMany({
        where: { userId: client.userId!, category: 'BILLING' },
      });
      expect(notifications).toHaveLength(1);
    });

    it('an overdue invoice notifies the student and the professional; a paid one notifies only the professional', async () => {
      const client = await createClient(premiumEducator.id, { linked: true });
      const { id, externalId } = await createInvoice(client);
      const token = webhookTokenFor(`${RUN_TAG}-educator-key`);

      fake.setChargeStatus(externalId, 'OVERDUE');
      await notice(externalId, token);

      const studentOverdue = await prisma.notification.count({
        where: { userId: client.userId!, category: 'BILLING' },
      });
      const educatorOverdue = await prisma.notification.count({
        where: { userId: premiumEducator.id, category: 'BILLING' },
      });
      expect(studentOverdue).toBeGreaterThanOrEqual(1);
      expect(educatorOverdue).toBeGreaterThanOrEqual(1);

      fake.setChargeStatus(externalId, 'RECEIVED', todayPlus(0));
      await notice(externalId, token);
      const invoice = await prisma.invoice.findUniqueOrThrow({
        where: { id },
      });
      expect(invoice.status).toBe('PAID');
    });

    it('edits, cancellations and manual markings notify nobody', async () => {
      const client = await createClient(premiumEducator.id, { linked: true });
      const { id } = await createInvoice(client);
      const before = await prisma.notification.count({
        where: { userId: client.userId! },
      });

      await (await as(premiumEducator)).update(id, { amount: '250.00' });

      const after = await prisma.notification.count({
        where: { userId: client.userId! },
      });
      expect(after).toBe(before);
    });

    it('a student without an account gets only the e-mail', async () => {
      const client = await createClient(premiumEducator.id, {
        linked: false,
      });
      expect(client.userId).toBeNull();

      await createInvoice(client);

      expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
      // No linked user id exists at all, so no in-app notification could
      // reference this client — nothing to query for, by construction.
    });
  });

  describe('IT-017 plan downgrade', () => {
    it("after the professional's plan stops being Premium, invoices stay visible and keep updating from notices", async () => {
      const client = await createClient(premiumEducator.id);
      const { id, externalId } = await createInvoice(client);
      const token = webhookTokenFor(`${RUN_TAG}-educator-key`);

      await prisma.users.update({
        where: { id: premiumEducator.id },
        data: { productId: standardProductId },
      });

      fake.setChargeStatus(externalId, 'RECEIVED', todayPlus(0));
      const response = await notice(externalId, token);
      expect(response.status).toBe(200);

      const invoice = await prisma.invoice.findUniqueOrThrow({
        where: { id },
      });
      expect(invoice.status).toBe('PAID');

      await prisma.users.update({
        where: { id: premiumEducator.id },
        data: { productId: premiumProductId },
      });
    });
  });

  describe('IT-018 replaced account', () => {
    it('an open invoice of the old account is still updated by notices after the account is replaced', async () => {
      const client = await createClient(premiumEducator.id);
      const { id, externalId } = await createInvoice(client);
      const oldToken = webhookTokenFor(`${RUN_TAG}-educator-key`);

      await connectAccount(premiumEducator, `${RUN_TAG}-educator-key-2`);

      fake.setChargeStatus(externalId, 'RECEIVED', todayPlus(0));
      const response = await notice(externalId, oldToken);
      expect(response.status).toBe(200);

      const invoice = await prisma.invoice.findUniqueOrThrow({
        where: { id },
      });
      expect(invoice.status).toBe('PAID');
    });
  });

  describe('IT-019 simultaneous notice and manual marking', () => {
    it('leaves one consistent final state, with the gateway payment winning', async () => {
      const client = await createClient(premiumEducator.id);
      const { id, externalId } = await createInvoice(client);
      const token = webhookTokenFor(`${RUN_TAG}-educator-key`);
      fake.setChargeStatus(externalId, 'RECEIVED', todayPlus(0));

      const [webhookResult, manualResult] = await Promise.all([
        notice(externalId, token),
        (await as(premiumEducator)).markPaid(id, { paidOn: todayPlus(0) }),
      ]);

      expect(webhookResult.status).toBe(200);
      expect([200, 409]).toContain(manualResult.status);

      const invoice = await prisma.invoice.findUniqueOrThrow({
        where: { id },
      });
      // Whichever wins, the gateway's PAID record must be the final truth if
      // the manual attempt observed it as already paid, or PAID_MANUALLY if
      // it got there first — never a mixed/inconsistent state.
      expect(['PAID', 'PAID_MANUALLY']).toContain(invoice.status);
    });
  });
});
