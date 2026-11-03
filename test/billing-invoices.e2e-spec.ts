/**
 * Integration tests for PRD `educator-billing`, task 2: the invoice
 * lifecycle against a real migrated database and the fake Asaas server.
 * Only the gateway and `MailService` are faked.
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
import { Client, ProductTier, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { FakeAsaasServer } from './support/fakeAsaasServer';

jest.setTimeout(120_000);

const RUN_TAG = `billinv-${Date.now()}`;
const JWT_SECRET =
  process.env.JWT_SECRET ?? 'billing-integration-jwt-secret-0123456789';
const fake = new FakeAsaasServer();
const sendNotificationEmail = jest.fn().mockResolvedValue(undefined);

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

describe('Invoices (integration, IT-003, IT-004, IT-005, IT-007, IT-008)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let groupId: string;
  let premiumEducator: Users;
  let standardEducator: Users;
  let premiumNutritionist: Users;
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
    process.env.BILLING_ENCRYPTION_KEY =
      process.env.BILLING_ENCRYPTION_KEY ??
      Buffer.alloc(32, 9).toString('base64');
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
              name: `${RUN_TAG} premium educator`,
              price: 59.9,
              tier: ProductTier.PREMIUM,
              type: ProductType.PHYSICAL_EDUCATOR,
            },
            {
              name: `${RUN_TAG} standard educator`,
              price: 59.9,
              tier: ProductTier.STANDARD,
              type: ProductType.PHYSICAL_EDUCATOR,
            },
            {
              name: `${RUN_TAG} premium nutri`,
              price: 59.9,
              tier: ProductTier.PREMIUM,
              type: ProductType.NUTRITIONIST,
            },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    premiumProductId = group.products.find(
      (p) =>
        p.tier === ProductTier.PREMIUM &&
        p.type === ProductType.PHYSICAL_EDUCATOR,
    )!.id;
    standardProductId = group.products.find(
      (p) => p.tier === ProductTier.STANDARD,
    )!.id;
    const premiumNutriProductId = group.products.find(
      (p) => p.type === ProductType.NUTRITIONIST,
    )!.id;

    premiumEducator = await createUser('premium-educator', premiumProductId);
    standardEducator = await createUser('standard-educator', standardProductId);
    premiumNutritionist = await createUser(
      'premium-nutri',
      premiumNutriProductId,
    );

    // Scoped to RUN_TAG, not the shared FAKE_KEYS.valid: this suite's
    // `account_key_in_use` uniqueness is enforced in the real, shared test
    // database, so a literal key would race with other e2e files' accounts
    // when Jest runs multiple spec files in parallel workers.
    await connectAccount(premiumEducator, `${RUN_TAG}-educator-key`);
    await connectAccount(premiumNutritionist, `${RUN_TAG}-nutri-key`);
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
    await prisma.studentTaxId.deleteMany({
      where: { client: { professionalId: { in: ids } } },
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
  ): Promise<void> {
    const response = await (await as(professional)).account.put(apiKey);
    expect(response.status).toBe(200);
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
      list: (clientId: string) =>
        request(server)
          .get(`/billing/students/${clientId}/invoices`)
          .set('Authorization', auth),
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
      cancel: (invoiceId: string) =>
        request(server)
          .post(`/billing/invoices/${invoiceId}/cancel`)
          .set('Authorization', auth),
      markPaid: (invoiceId: string, body: Record<string, unknown>) =>
        request(server)
          .post(`/billing/invoices/${invoiceId}/mark-paid`)
          .set('Authorization', auth)
          .send(body),
      resend: (invoiceId: string) =>
        request(server)
          .post(`/billing/invoices/${invoiceId}/resend`)
          .set('Authorization', auth),
    };
  }

  beforeEach(() => {
    sendNotificationEmail.mockClear();
    fake.requests.length = 0;
  });

  describe('IT-003 Premium gate across professions and tiers', () => {
    it('a standard-tier professional is blocked from mutations but reads still succeed', async () => {
      const client = await createClient(standardEducator.id);

      const blocked = await (
        await as(standardEducator)
      ).create(client.id, invoiceDto());
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('premium_required');

      const listOk = await (await as(standardEducator)).list(client.id);
      expect(listOk.status).toBe(200);
    });

    it('a premium nutritionist can generate an invoice', async () => {
      const client = await createClient(premiumNutritionist.id);
      const response = await (
        await as(premiumNutritionist)
      ).create(client.id, invoiceDto());
      expect(response.status).toBe(201);
    });

    it('downgrading blocks mutations; upgrading restores them with no reconnection', async () => {
      const client = await createClient(premiumEducator.id);

      await prisma.users.update({
        where: { id: premiumEducator.id },
        data: { productId: standardProductId },
      });
      const blocked = await (
        await as(premiumEducator)
      ).create(client.id, invoiceDto());
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('premium_required');

      await prisma.users.update({
        where: { id: premiumEducator.id },
        data: { productId: premiumProductId },
      });
      fake.requests.length = 0;
      const restored = await (
        await as(premiumEducator)
      ).create(client.id, invoiceDto());
      expect(restored.status).toBe(201);
      expect(
        fake.requests.some(
          (r) => r.method === 'POST' && r.path === '/webhooks',
        ),
      ).toBe(false);
    });
  });

  describe('IT-004 generating the first invoice', () => {
    it('requires the tax number, stores it encrypted, masks it in the list, creates the charge, e-mails the link once, and notifies a linked student', async () => {
      const client = await createClient(premiumEducator.id, { linked: true });

      const missingTaxId = await (
        await as(premiumEducator)
      ).create(client.id, invoiceDto({ cpfCnpj: undefined }));
      expect(missingTaxId.status).toBe(400);
      expect(missingTaxId.body.code).toBe('tax_id_required');

      const response = await (
        await as(premiumEducator)
      ).create(client.id, invoiceDto());
      expect(response.status).toBe(201);
      expect(response.body.emailSent).toBe(true);
      expect(sendNotificationEmail).toHaveBeenCalledTimes(1);

      const stored = await prisma.studentTaxId.findUnique({
        where: { clientId: client.id },
      });
      expect(stored!.ciphertext).not.toContain('52998224725');

      const list = await (await as(premiumEducator)).list(client.id);
      expect(list.status).toBe(200);
      expect(list.body.taxId).toMatchObject({ present: true });
      expect(list.body.taxId.masked).not.toBe('52998224725');
      expect(
        list.body.items.some((i: { id: string }) => i.id === response.body.id),
      ).toBe(true);

      const chargeRequest = fake.requests.find(
        (r) => r.method === 'POST' && r.path === '/payments',
      );
      expect(chargeRequest).toBeDefined();

      const notification = await prisma.notification.findFirst({
        where: { category: 'BILLING' },
        orderBy: { createdAt: 'desc' },
      });
      expect(notification).not.toBeNull();
    });
  });

  describe('IT-005 duplicates and double clicks', () => {
    it('two simultaneous creations for the same student and month leave exactly one invoice; a new one succeeds after canceling', async () => {
      const client = await createClient(premiumEducator.id);
      const { year, month } = currentCompetence();
      const dto = invoiceDto();

      const caller = await as(premiumEducator);
      const [first, second] = await Promise.all([
        caller.create(client.id, dto),
        caller.create(client.id, dto),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);
      const rejected = first.status === 409 ? first : second;
      expect(rejected.body.code).toBe('invoice_exists_for_month');

      const count = await prisma.invoice.count({
        where: {
          clientId: client.id,
          competenceYear: year,
          competenceMonth: month,
          status: { not: 'CANCELED' },
        },
      });
      expect(count).toBe(1);

      const created = first.status === 201 ? first : second;
      await caller.cancel(created.body.id);
      const again = await caller.create(client.id, dto);
      expect(again.status).toBe(201);
    });
  });

  describe('IT-007 edit, cancel, mark paid and concurrent edits', () => {
    it('edits and cancels against the fake server', async () => {
      const client = await createClient(premiumEducator.id);
      const caller = await as(premiumEducator);
      const created = await caller.create(client.id, invoiceDto());
      expect(created.status).toBe(201);

      const edited = await caller.update(created.body.id, {
        amount: '250.00',
      });
      expect(edited.status).toBe(200);
      expect(edited.body.amountCents).toBe(25000);
      const putRequest = fake.requests.find(
        (r) => r.method === 'PUT' && r.path.startsWith('/payments/'),
      );
      expect(putRequest?.body).toMatchObject({ value: 250 });

      const canceled = await caller.cancel(created.body.id);
      expect(canceled.status).toBe(200);
      expect(canceled.body.status).toBe('CANCELED');
      expect(
        fake.requests.some(
          (r) => r.method === 'DELETE' && r.path.startsWith('/payments/'),
        ),
      ).toBe(true);
    });

    it('marks an invoice as paid outside the gateway', async () => {
      const client = await createClient(premiumEducator.id);
      const caller = await as(premiumEducator);
      const created = await caller.create(client.id, invoiceDto());

      const marked = await caller.markPaid(created.body.id, {
        paidOn: todayPlus(0),
        note: 'Pago em dinheiro.',
      });
      expect(marked.status).toBe(200);
      expect(marked.body.status).toBe('PAID_MANUALLY');
    });

    it('a charge the fake reports as already paid turns the invoice paid and answers 409', async () => {
      const client = await createClient(premiumEducator.id);
      const caller = await as(premiumEducator);
      const created = await caller.create(client.id, invoiceDto());
      const row = await prisma.invoice.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      fake.setChargeStatus(row.externalId!, 'RECEIVED', todayPlus(0));

      const edited = await caller.update(created.body.id, { amount: '300.00' });
      expect(edited.status).toBe(409);
      expect(edited.body.code).toBe('invoice_already_paid');

      const after = await prisma.invoice.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      expect(after.status).toBe('PAID');
    });

    it('two concurrent edits leave the invoice equal to exactly one of the two requests', async () => {
      const client = await createClient(premiumEducator.id);
      const caller = await as(premiumEducator);
      const created = await caller.create(client.id, invoiceDto());

      const [a, b] = await Promise.all([
        caller.update(created.body.id, { amount: '111.00' }),
        caller.update(created.body.id, { amount: '222.00' }),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);

      const final = await prisma.invoice.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      expect([11100, 22200]).toContain(final.amountCents);
    });
  });

  describe('IT-008 resend limit', () => {
    it('allows resend once, refuses it within the hour, and allows it again once the window has passed', async () => {
      const client = await createClient(premiumEducator.id, { linked: true });
      const caller = await as(premiumEducator);
      const created = await caller.create(client.id, invoiceDto());
      sendNotificationEmail.mockClear();

      const resent = await caller.resend(created.body.id);
      expect(resent.status).toBe(204);
      expect(sendNotificationEmail).toHaveBeenCalledTimes(1);

      const tooSoon = await caller.resend(created.body.id);
      expect(tooSoon.status).toBe(429);
      expect(tooSoon.body.code).toBe('resend_too_soon');
      expect(tooSoon.body.details.minutesLeft).toBeGreaterThan(0);

      await prisma.invoice.update({
        where: { id: created.body.id },
        data: { linkSentAt: new Date(Date.now() - 61 * 60_000) },
      });
      sendNotificationEmail.mockClear();
      const allowedAgain = await caller.resend(created.body.id);
      expect(allowedAgain.status).toBe(204);
      expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
    });
  });
});
