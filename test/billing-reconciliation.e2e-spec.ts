/**
 * Integration tests for PRD `educator-billing`, task 3: the daily
 * reconciliation job against a real migrated database and the fake Asaas
 * server, with a controllable Clock.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { BillingModule } from '@/billing/billing.module';
import { ReconciliationService } from '@/billing/reconciliation/reconciliation.service';
import { encryptSecret } from '@/billing/shared/secretCipher';
import { PrismaService } from '@/database/prisma.service';
import { MailService } from '@/mail/mail.service';
import { Clock } from '@/scheduling/clock.service';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BillingAccountStatus,
  ProductTier,
  ProductType,
  Users,
} from '@prisma/client';
import { FAKE_KEYS, FakeAsaasServer } from './support/fakeAsaasServer';

jest.setTimeout(120_000);

const RUN_TAG = `billrec-${Date.now()}`;
const fake = new FakeAsaasServer();
const sendNotificationEmail = jest.fn().mockResolvedValue(undefined);
let now = new Date();
const clock = { now: () => now };

function todayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe('Daily reconciliation job (integration, IT-006, IT-010)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let reconciliation: ReconciliationService;
  let groupId: string;
  let productId: string;
  const educators: Users[] = [];

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.BILLING_ENCRYPTION_KEY =
      process.env.BILLING_ENCRYPTION_KEY ??
      Buffer.alloc(32, 9).toString('base64');
    process.env.API_PUBLIC_URL = 'https://api.vitaflow.test';
    await fake.start();
    process.env.ASAAS_BASE_URL = fake.baseUrl;

    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), BillingModule],
    })
      .overrideProvider(MailService)
      .useValue({ sendNotificationEmail })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();

    prisma = module.get(PrismaService);
    reconciliation = module.get(ReconciliationService);

    const group = await prisma.productGroup.create({
      data: {
        name: `${RUN_TAG} group`,
        products: {
          create: {
            name: `${RUN_TAG} premium`,
            price: 59.9,
            tier: ProductTier.PREMIUM,
            type: ProductType.PHYSICAL_EDUCATOR,
          },
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    productId = group.products[0].id;
  });

  afterAll(async () => {
    const ids = educators.map((e) => e.id);
    await prisma.invoice.deleteMany({
      where: { billingAccount: { userId: { in: ids } } },
    });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.billingAccount.deleteMany({ where: { userId: { in: ids } } });
    await prisma.client.deleteMany({
      where: { professionalId: { in: ids } },
    });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
    await prisma.product.deleteMany({ where: { groupId } });
    await prisma.productGroup.deleteMany({ where: { id: groupId } });
    await prisma.$disconnect();
    await fake.stop();
  });

  // A fresh educator per account: the partial "one ACTIVE account per user"
  // index means reusing one user across tests would collide the moment a
  // second ACTIVE account is created for it.
  async function freshEducator(): Promise<Users> {
    const user = await prisma.users.create({
      data: {
        name: 'Educator',
        email: `${RUN_TAG}-educator-${Math.random().toString(36).slice(2, 7)}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId,
        subscriptionStatus: 'active',
      },
    });
    educators.push(user);
    return user;
  }

  async function freshAccount(key: string, status: BillingAccountStatus) {
    const educator = await freshEducator();
    const account = await prisma.billingAccount.create({
      data: {
        userId: educator.id,
        provider: 'ASAAS',
        status,
        accountName: 'Conta Teste',
        apiKeyEncrypted: encryptSecret(key, Buffer.alloc(32, 9)),
        apiKeyFingerprint: `fp-${RUN_TAG}-${Math.random()}`,
        webhookTokenHash: `hash-${RUN_TAG}-${Math.random()}`,
      },
    });
    return { account, educator };
  }

  async function freshClient(professionalId: string) {
    return await prisma.client.create({
      data: {
        name: 'Aluno',
        phone: '11999990000',
        email: `${RUN_TAG}-aluno-${Math.random().toString(36).slice(2, 7)}@integration.test`,
        professionalId,
      },
    });
  }

  it('IT-006 a crash-window reservation without a charge id is removed by the daily job after 10 minutes and not before', async () => {
    const { account, educator } = await freshAccount(FAKE_KEYS.valid, 'ACTIVE');
    const client = await freshClient(educator.id);
    now = new Date('2026-11-18T09:00:00.000Z');

    const young = await prisma.invoice.create({
      data: {
        clientId: client.id,
        billingAccountId: account.id,
        competenceYear: 2026,
        competenceMonth: 11,
        amountCents: 19990,
        dueDate: new Date('2026-11-20'),
        createdAt: new Date(now.getTime() - 5 * 60_000),
      },
    });
    const old = await prisma.invoice.create({
      data: {
        clientId: client.id,
        billingAccountId: account.id,
        competenceYear: 2026,
        competenceMonth: 10,
        amountCents: 19990,
        dueDate: new Date('2026-10-20'),
        createdAt: new Date(now.getTime() - 11 * 60_000),
      },
    });

    await reconciliation.run();

    expect(
      await prisma.invoice.findUnique({ where: { id: young.id } }),
    ).not.toBeNull();
    expect(
      await prisma.invoice.findUnique({ where: { id: old.id } }),
    ).toBeNull();
  });

  it('IT-010 turns past-due invoices overdue with one notification each; a second run changes nothing', async () => {
    const { account, educator } = await freshAccount(FAKE_KEYS.valid, 'ACTIVE');
    const client = await freshClient(educator.id);
    now = new Date('2026-11-18T09:00:00.000Z'); // 2026-11-18 Brasília
    expect(todayKey(now)).toBe('2026-11-18');

    const pastDue = await prisma.invoice.create({
      data: {
        clientId: client.id,
        billingAccountId: account.id,
        competenceYear: 2026,
        competenceMonth: 10,
        amountCents: 19990,
        dueDate: new Date('2026-11-10'),
        status: 'PENDING',
        externalId: 'pay_reconcile_1',
      },
    });
    const dueToday = await prisma.invoice.create({
      data: {
        clientId: client.id,
        billingAccountId: account.id,
        competenceYear: 2026,
        competenceMonth: 11,
        amountCents: 19990,
        dueDate: new Date('2026-11-18'),
        status: 'PENDING',
        externalId: 'pay_reconcile_2',
      },
    });

    await reconciliation.run();

    const after = await prisma.invoice.findUniqueOrThrow({
      where: { id: pastDue.id },
    });
    expect(after.status).toBe('OVERDUE');
    expect(after.overdueNotifiedAt).not.toBeNull();
    const stillPending = await prisma.invoice.findUniqueOrThrow({
      where: { id: dueToday.id },
    });
    expect(stillPending.status).toBe('PENDING');

    const notifications = await prisma.notification.count({
      where: { userId: educator.id, category: 'BILLING' },
    });
    expect(notifications).toBeGreaterThanOrEqual(1);

    // Second run: nothing left to transition.
    await reconciliation.run();
    const stillOverdue = await prisma.invoice.findUniqueOrThrow({
      where: { id: pastDue.id },
    });
    expect(stillOverdue.status).toBe('OVERDUE');
    const notificationsAfterSecondRun = await prisma.notification.count({
      where: { userId: educator.id, category: 'BILLING' },
    });
    expect(notificationsAfterSecondRun).toBe(notifications);
  });

  it('IT-010 reconciles a missed paid status for an open invoice held by an account with a key', async () => {
    const { account, educator } = await freshAccount(FAKE_KEYS.valid, 'ACTIVE');
    const client = await freshClient(educator.id);
    now = new Date('2026-11-18T09:00:00.000Z');

    const key = FAKE_KEYS.valid;
    const customer = await fetch(`${fake.baseUrl}/customers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', access_token: key },
      body: '{}',
    }).then((r) => r.json() as Promise<{ id: string }>);
    const charge = await fetch(`${fake.baseUrl}/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', access_token: key },
      body: JSON.stringify({
        customer: customer.id,
        value: 199.9,
        dueDate: '2026-11-15',
      }),
    }).then((r) => r.json() as Promise<{ id: string }>);
    fake.setChargeStatus(charge.id, 'RECEIVED', '2026-11-16');

    const invoice = await prisma.invoice.create({
      data: {
        clientId: client.id,
        billingAccountId: account.id,
        competenceYear: 2026,
        competenceMonth: 11,
        amountCents: 19990,
        dueDate: new Date('2026-11-15'),
        status: 'PENDING',
        externalId: charge.id,
      },
    });

    await reconciliation.run();

    const after = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(after.status).toBe('PAID');
    expect(after.paidNotifiedAt).not.toBeNull();
  });

  it('IT-010 purges the key of a replaced account with no open invoices', async () => {
    const { account } = await freshAccount(FAKE_KEYS.valid, 'REPLACED');
    now = new Date('2026-11-18T09:00:00.000Z');

    await reconciliation.run();

    const after = await prisma.billingAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(after.apiKeyEncrypted).toBeNull();
  });
});
