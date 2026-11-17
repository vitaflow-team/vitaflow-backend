/**
 * Shared harness for the financial-health integration suites: the real
 * BillingModule and FinancialHealthModule over an isolated migrated database,
 * with only the gateway (fake Asaas server), the mail service and the clock
 * replaced. Also the seeding helpers the gym cases rely on: gym fees are
 * written straight into the database because issuing them belongs to the
 * recurring-billing task.
 */
import { BillingModule } from '@/billing/billing.module';
import { hashWebhookToken } from '@/billing/shared/credentials';
import { encryptSecret } from '@/billing/shared/secretCipher';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { FinancialHealthModule } from '@/financial-health/financialHealth.module';
import { MailService } from '@/mail/mail.service';
import { Clock } from '@/scheduling/clock.service';
import { INestApplication, Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  AcademiaAccessPlan,
  AcademiaStaffMember,
  AccessPlanValidityType,
  BillingAccount,
  BillingAccountStatus,
  Client,
  Invoice,
  InvoiceStatus,
  ProductTier,
  ProductType,
  Users,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { FakeAsaasServer } from './fakeAsaasServer';

export const JWT_SECRET =
  process.env.JWT_SECRET ?? 'billing-integration-jwt-secret-0123456789';
export const CIPHER_KEY = Buffer.alloc(32, 9);

export interface SeedInvoiceInput {
  clientId: string;
  billingAccountId: string;
  competence: { year: number; month: number };
  amountCents: number;
  dueDate: string;
  status?: InvoiceStatus;
  paidAt?: string | null;
  paidAmountCents?: number | null;
  externalId?: string | null;
  recurringBillingId?: string | null;
  paymentUrl?: string | null;
}

export class FinancialHealthHarness {
  readonly fake = new FakeAsaasServer();
  readonly sendNotificationEmail = jest.fn().mockResolvedValue(undefined);
  app!: INestApplication;
  prisma!: PrismaService;
  jwt!: JwtService;
  now = new Date();
  products!: {
    premiumEducator: string;
    standardEducator: string;
    premiumNutritionist: string;
    academia: string;
    user: string;
  };
  private groupId!: string;
  private sequence = 0;

  constructor(
    readonly tag: string,
    private readonly extraModules: Type<unknown>[] = [],
  ) {}

  async start(): Promise<void> {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.BILLING_ENCRYPTION_KEY = CIPHER_KEY.toString('base64');
    process.env.API_PUBLIC_URL = 'https://api.vitaflow.test';
    await this.fake.start();
    process.env.ASAAS_BASE_URL = this.fake.baseUrl;

    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        BillingModule,
        FinancialHealthModule,
        ...this.extraModules,
      ],
    })
      .overrideProvider(MailService)
      .useValue({ sendNotificationEmail: this.sendNotificationEmail })
      .overrideProvider(Clock)
      .useValue({ now: () => this.now })
      .compile();
    moduleFixture.useLogger(false);
    this.app = moduleFixture.createNestApplication();
    this.app.useGlobalPipes(createValidationPipe());
    await this.app.init();
    this.prisma = moduleFixture.get(PrismaService);
    this.jwt = moduleFixture.get(JwtService, { strict: false });
    await this.createProducts();
  }

  async stop(): Promise<void> {
    await this.cleanup();
    await this.prisma.$disconnect();
    await this.app.close();
    await this.fake.stop();
  }

  setNow(iso: string): void {
    this.now = new Date(iso);
  }

  // --- Users, accounts, clients ---

  async createUser(
    label: string,
    productId: string,
    extra: { academiaId?: string; subscriptionStatus?: string | null } = {},
  ): Promise<Users> {
    return await this.prisma.users.create({
      data: {
        name: `User ${label}`,
        email: `${this.tag}-${label}-${this.next()}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId,
        subscriptionStatus:
          extra.subscriptionStatus === undefined
            ? 'active'
            : extra.subscriptionStatus,
        academiaId: extra.academiaId,
      },
    });
  }

  async createGymOwner(
    label: string,
    subscriptionStatus: string | null = 'active',
  ): Promise<{ owner: Users; academiaId: string }> {
    const academia = await this.prisma.academia.create({
      data: { name: `${this.tag} academia ${label}` },
    });
    const owner = await this.createUser(label, this.products.academia, {
      academiaId: academia.id,
      subscriptionStatus,
    });
    return { owner, academiaId: academia.id };
  }

  // An account row written directly: enough for the panels, which read the
  // account state and scope invoices through it.
  async createAccount(
    owner: Users,
    overrides: Partial<{
      status: BillingAccountStatus;
      keyInvalidAt: Date | null;
      apiKey: string;
      disconnected: boolean;
    }> = {},
  ): Promise<BillingAccount> {
    const id = this.next();
    const apiKey = overrides.apiKey ?? `${this.tag}-key-${id}`;
    return await this.prisma.billingAccount.create({
      data: {
        userId: owner.id,
        provider: 'ASAAS',
        status: overrides.status ?? BillingAccountStatus.ACTIVE,
        accountName: `Conta ${id}`,
        apiKeyEncrypted: overrides.disconnected
          ? null
          : encryptSecret(apiKey, CIPHER_KEY),
        apiKeyFingerprint: `fp-${this.tag}-${id}`,
        webhookTokenHash: hashWebhookToken(`token-${this.tag}-${id}`),
        keyInvalidAt: overrides.keyInvalidAt ?? null,
      },
    });
  }

  // Connects through the real route so the gateway key, the webhook
  // registration and its token exist; returns the raw webhook token.
  async connectViaApi(user: Users, apiKey: string): Promise<string> {
    const response = await this.get(user, 'put', '/billing/account').send({
      apiKey,
    });
    expect(response.status).toBe(200);
    return this.webhookTokenFor(apiKey);
  }

  webhookTokenFor(apiKey: string): string {
    const registration = this.fake.requests
      .filter(
        (r) =>
          r.method === 'POST' &&
          r.path === '/webhooks' &&
          r.headers['access_token'] === apiKey,
      )
      .at(-1)!;
    return registration.body!.authToken as string;
  }

  async createClient(input: {
    name?: string;
    userId?: string | null;
    professionalId?: string | null;
    academiaId?: string | null;
  }): Promise<Client> {
    return await this.prisma.client.create({
      data: {
        name: input.name ?? `Aluno ${this.next()}`,
        phone: '11999990000',
        email: `${this.tag}-aluno-${this.next()}@integration.test`,
        userId: input.userId ?? null,
        professionalId: input.professionalId ?? null,
        academiaId: input.academiaId ?? null,
      },
    });
  }

  // --- Invoices ---

  async seedInvoice(input: SeedInvoiceInput): Promise<Invoice> {
    const status = input.status ?? InvoiceStatus.PENDING;
    return await this.prisma.invoice.create({
      data: {
        clientId: input.clientId,
        billingAccountId: input.billingAccountId,
        competenceYear: input.competence.year,
        competenceMonth: input.competence.month,
        amountCents: input.amountCents,
        dueDate: new Date(input.dueDate),
        status,
        externalId:
          input.externalId === undefined
            ? `seed_${this.tag}_${this.next()}`
            : input.externalId,
        recurringBillingId: input.recurringBillingId ?? null,
        paymentUrl: input.paymentUrl ?? null,
        paidAt: input.paidAt ? new Date(input.paidAt) : null,
        paidAmountCents: input.paidAmountCents ?? null,
      },
    });
  }

  // A gym fee as the recurring issuer will produce it: an invoice on the
  // gym owner's account for one of its students, backed by a real charge at
  // the fake gateway so webhooks and gateway checks can act on it.
  async seedGymFee(input: {
    account: BillingAccount;
    clientId: string;
    competence: { year: number; month: number };
    amountCents: number;
    dueDate: string;
    status?: InvoiceStatus;
    paidAt?: string | null;
    recurringBillingId?: string | null;
    paymentUrl?: string | null;
  }): Promise<Invoice> {
    const chargeId = this.fake.addCharge({
      valueCents: input.amountCents,
      dueDate: input.dueDate,
    });
    return await this.seedInvoice({
      ...input,
      billingAccountId: input.account.id,
      externalId: chargeId,
    });
  }

  // --- Gym plans, tax IDs and reception ---

  async createAccessPlan(
    academiaId: string,
    input: { name?: string; priceReais: number; active?: boolean },
  ): Promise<AcademiaAccessPlan> {
    return await this.prisma.academiaAccessPlan.create({
      data: {
        academiaId,
        name: input.name ?? `Plano ${this.next()}`,
        validityType: AccessPlanValidityType.DAYS,
        validityValue: 30,
        referencePrice: input.priceReais,
        active: input.active ?? true,
      },
    });
  }

  // A student already linked to a plan before recurring billing existed.
  async linkStudentToPlan(
    clientId: string,
    plan: AcademiaAccessPlan,
  ): Promise<void> {
    await this.prisma.studentAccessPlan.create({
      data: {
        clientId,
        accessPlanId: plan.id,
        validityType: plan.validityType,
        validityValue: plan.validityValue,
        referencePrice: plan.referencePrice,
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
        status: 'ACTIVE',
      },
    });
  }

  async storeTaxId(clientId: string, digits = '52998224725'): Promise<void> {
    await this.prisma.studentTaxId.upsert({
      where: { clientId },
      create: { clientId, ciphertext: encryptSecret(digits, CIPHER_KEY) },
      update: { ciphertext: encryptSecret(digits, CIPHER_KEY) },
    });
  }

  async createReceptionist(academiaId: string): Promise<AcademiaStaffMember> {
    return await this.prisma.academiaStaffMember.create({
      data: {
        academiaId,
        name: `Recepcao ${this.next()}`,
        email: `${this.tag}-staff-${this.next()}@integration.test`,
        active: true,
      },
    });
  }

  // --- HTTP ---

  server(): App {
    return this.app.getHttpServer() as App;
  }

  bearer(user: { id: string; email: string }): string {
    const token = this.jwt.sign(
      { id: user.id, email: user.email },
      { secret: JWT_SECRET },
    );
    return `Bearer ${token}`;
  }

  get(
    user: { id: string; email: string },
    method: 'get' | 'put' | 'post' | 'patch' | 'delete',
    path: string,
  ) {
    return request(this.server())
      [method](path)
      .set('Authorization', this.bearer(user));
  }

  summary(user: { id: string; email: string }, month?: string) {
    const query = month === undefined ? '' : `?month=${month}`;
    return this.get(user, 'get', `/financial-health/summary${query}`);
  }

  delinquents(user: { id: string; email: string }, page?: string) {
    const query = page === undefined ? '' : `?page=${page}`;
    return this.get(user, 'get', `/financial-health/delinquents${query}`);
  }

  notice(chargeId: string, token: string | undefined) {
    const call = request(this.server())
      .post('/billing/webhooks/asaas')
      .send({ event: 'PAYMENT_RECEIVED', payment: { id: chargeId } });
    return token === undefined ? call : call.set('asaas-access-token', token);
  }

  // --- Setup and teardown ---

  private async createProducts(): Promise<void> {
    const group = await this.prisma.productGroup.create({
      data: {
        name: `${this.tag} group`,
        products: {
          create: [
            this.product(
              'premium educator',
              ProductType.PHYSICAL_EDUCATOR,
              ProductTier.PREMIUM,
            ),
            this.product(
              'standard educator',
              ProductType.PHYSICAL_EDUCATOR,
              ProductTier.STANDARD,
            ),
            this.product(
              'premium nutritionist',
              ProductType.NUTRITIONIST,
              ProductTier.PREMIUM,
            ),
            this.product(
              'academia',
              ProductType.ACADEMIA,
              ProductTier.STANDARD,
            ),
            this.product('user', ProductType.USER, ProductTier.FREE),
          ],
        },
      },
      include: { products: true },
    });
    this.groupId = group.id;
    const byName = (suffix: string) =>
      group.products.find((p) => p.name === `${this.tag} ${suffix}`)!.id;
    this.products = {
      premiumEducator: byName('premium educator'),
      standardEducator: byName('standard educator'),
      premiumNutritionist: byName('premium nutritionist'),
      academia: byName('academia'),
      user: byName('user'),
    };
  }

  private product(name: string, type: ProductType, tier: ProductTier) {
    return { name: `${this.tag} ${name}`, price: 59.9, type, tier };
  }

  private async cleanup(): Promise<void> {
    const prisma = this.prisma;
    const users = await prisma.users.findMany({
      where: { email: { startsWith: this.tag } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    const academias = await prisma.academia.findMany({
      where: { name: { startsWith: this.tag } },
      select: { id: true },
    });
    const academiaIds = academias.map((a) => a.id);
    const clientIds = (
      await prisma.client.findMany({
        where: { email: { startsWith: this.tag } },
        select: { id: true },
      })
    ).map((c) => c.id);

    await prisma.invoice.deleteMany({
      where: {
        OR: [
          { clientId: { in: clientIds } },
          { billingAccount: { userId: { in: userIds } } },
        ],
      },
    });
    await prisma.checkIn.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.studentAccessPlan.deleteMany({
      where: { clientId: { in: clientIds } },
    });
    await prisma.billingCustomer.deleteMany({
      where: { billingAccount: { userId: { in: userIds } } },
    });
    await prisma.notification.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.billingAccount.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.academiaStaffMember.deleteMany({
      where: { academiaId: { in: academiaIds } },
    });
    await prisma.employment.deleteMany({
      where: { academiaId: { in: academiaIds } },
    });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.academiaAccessPlan.deleteMany({
      where: { academiaId: { in: academiaIds } },
    });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
    await prisma.academia.deleteMany({ where: { id: { in: academiaIds } } });
    await prisma.product.deleteMany({ where: { groupId: this.groupId } });
    await prisma.productGroup.deleteMany({ where: { id: this.groupId } });
  }

  private next(): string {
    this.sequence += 1;
    return `${this.sequence}-${Math.random().toString(36).slice(2, 7)}`;
  }
}
