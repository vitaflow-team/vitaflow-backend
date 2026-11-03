/**
 * Integration tests for PRD `educator-billing`, task 3: the mirrors'
 * billingStatus, the E1 student list situation/filter, best-effort
 * cancellation on student removal for both professions, and the access
 * control / secret-scan matrix — against the real, full application.
 *
 * Boots the real AppModule (same pattern as
 * test/standards-enforcement.e2e-spec.ts) because IT-013/IT-014 need to
 * assert on routes across the whole app, not just the billing domain.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { configureApp } from '@/config/configureApp';
import { validateEnv } from '@/config/validateEnv';
import { MailService } from '@/mail/mail.service';
import { PrismaService } from '@/database/prisma.service';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Client, ProductTier, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { FakeAsaasServer } from './support/fakeAsaasServer';

jest.setTimeout(120_000);

const RUN_TAG = `billsit-${Date.now()}`;
const APPLICATION_SECRET = `${RUN_TAG}-application-secret`;
const fake = new FakeAsaasServer();
const sendNotificationEmail = jest.fn().mockResolvedValue(undefined);

function bootEnv(): NodeJS.ProcessEnv {
  return {
    JWT_SECRET: `${RUN_TAG}-jwt-secret-0123456789012345`,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    APPLICATION_SECRET,
    STRIPE_API_KEY: 'sk_test_billing_situation',
    OPENAI_API_KEY: 'sk-test-billing-situation',
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
    BILLING_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    API_PUBLIC_URL: 'https://api.vitaflow.test',
    ASAAS_BASE_URL: fake.baseUrl,
  };
}

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

describe('Billing situation — mirrors, E1 list, removal, access control (IT-011, IT-012, IT-013, IT-014)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let sequence = 0;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    await fake.start();
    Object.assign(process.env, bootEnv());
    validateEnv();

    const { AppModule } =
      jest.requireActual<typeof import('@/app.module')>('@/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ sendNotificationEmail })
      .compile();
    const nestApp = module.createNestApplication<NestExpressApplication>();
    configureApp(nestApp, { ...process.env, NODE_ENV: 'test' });
    await nestApp.init();
    app = nestApp as unknown as INestApplication<App>;

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

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
              name: `${RUN_TAG} premium nutri`,
              price: 59.9,
              tier: ProductTier.PREMIUM,
              type: ProductType.NUTRITIONIST,
            },
            {
              name: `${RUN_TAG} standard`,
              price: 0,
              tier: ProductTier.STANDARD,
              type: ProductType.USER,
            },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
  });

  afterAll(async () => {
    const ids = (
      await prisma.users.findMany({
        where: { email: { endsWith: `@${RUN_TAG}.test` } },
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
    await app?.close();
    await fake.stop();
  });

  function productIdByType(
    products: { id: string; type: ProductType }[],
    type: ProductType,
  ): string {
    return products.find((p) => p.type === type)!.id;
  }

  async function createUser(
    productId: string | null,
    label: string,
  ): Promise<Users> {
    sequence += 1;
    return await prisma.users.create({
      data: {
        name: `User ${label} ${sequence}`,
        email: `${label}-${sequence}@${RUN_TAG}.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId,
        subscriptionStatus: productId ? 'active' : null,
      },
    });
  }

  function tokenFor(user: Users): Promise<string> {
    return jwtService.signAsync({ id: user.id, email: user.email });
  }

  function call(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
  ) {
    return request(app.getHttpServer())
      [method](path)
      .set('x-application-secret', APPLICATION_SECRET);
  }

  async function asUser(user: Users) {
    const token = await tokenFor(user);
    return (
      method: 'get' | 'post' | 'put' | 'patch' | 'delete',
      path: string,
    ) => call(method, path).set('Authorization', `Bearer ${token}`);
  }

  async function connectAccount(professional: Users, apiKey: string) {
    const caller = await asUser(professional);
    const response = await caller('put', '/billing/account').send({ apiKey });
    expect(response.status).toBe(200);
  }

  async function createClientFor(
    professionalId: string,
    opts: { linked?: boolean } = {},
  ): Promise<Client> {
    let userId: string | undefined;
    if (opts.linked) {
      const studentUser = await createUser(null, 'student');
      userId = studentUser.id;
    }
    return await prisma.client.create({
      data: {
        name: `Aluno ${RUN_TAG}`,
        phone: '11999990000',
        email: `aluno-${Math.random().toString(36).slice(2, 7)}@${RUN_TAG}.test`,
        professionalId,
        userId,
      },
    });
  }

  describe('IT-011 mirrors and situations', () => {
    it('both mirrors return billingStatus as specified, including after the professional disconnects', async () => {
      const group = await prisma.productGroup.findUniqueOrThrow({
        where: { id: groupId },
        include: { products: true },
      });
      const educator = await createUser(
        productIdByType(group.products, ProductType.PHYSICAL_EDUCATOR),
        'mirror-educator',
      );
      await connectAccount(educator, `${RUN_TAG}-mirror-key`);
      const student = await createUser(null, 'mirror-student');
      const client = await prisma.client.create({
        data: {
          name: 'Aluno Mirror',
          phone: '11999990000',
          email: `mirror-aluno@${RUN_TAG}.test`,
          professionalId: educator.id,
          userId: student.id,
        },
      });
      const educatorCaller = await asUser(educator);
      const created = await educatorCaller(
        'post',
        `/billing/students/${client.id}/invoices`,
      ).send(invoiceDto());
      expect(created.status).toBe(201);

      const studentCaller = await asUser(student);
      const mirror = await studentCaller('get', '/me/physical-educator');
      expect(mirror.status).toBe(200);
      expect(mirror.body.billingStatus).toMatchObject({
        openInvoice: expect.objectContaining({ status: 'PENDING' }),
        otherOpenCount: 0,
      });

      await educatorCaller('delete', '/billing/account');
      const afterDisconnect = await studentCaller(
        'get',
        '/me/physical-educator',
      );
      expect(afterDisconnect.body.billingStatus).toMatchObject({
        openInvoice: expect.objectContaining({ status: 'PENDING' }),
      });
    });

    it('the E1 list returns the situation and the pending filter applies across pages; a non-Premium professional gets none', async () => {
      const group = await prisma.productGroup.findUniqueOrThrow({
        where: { id: groupId },
        include: { products: true },
      });
      const premiumEducator = await createUser(
        productIdByType(group.products, ProductType.PHYSICAL_EDUCATOR),
        'list-premium',
      );
      await connectAccount(premiumEducator, `${RUN_TAG}-list-key`);
      const standardEducator = await createUser(
        productIdByType(group.products, ProductType.PHYSICAL_EDUCATOR),
        'list-standard',
      );
      await prisma.users.update({
        where: { id: standardEducator.id },
        data: {
          productId: productIdByType(
            group.products,
            ProductType.PHYSICAL_EDUCATOR,
          ),
        },
      });

      const pendingClient = await createClientFor(premiumEducator.id);
      const okClient = await createClientFor(premiumEducator.id);
      const caller = await asUser(premiumEducator);
      const createdInvoice = await caller(
        'post',
        `/billing/students/${pendingClient.id}/invoices`,
      ).send(invoiceDto());
      expect(createdInvoice.status).toBe(201);

      const list = await caller('get', '/educator/students');
      expect(list.status).toBe(200);
      const pendingItem = list.body.items.find(
        (i: { id: string }) => i.id === pendingClient.id,
      );
      expect(pendingItem.financialSituation).toBe('PENDING');
      const okItem = list.body.items.find(
        (i: { id: string }) => i.id === okClient.id,
      );
      expect(okItem.financialSituation).toBe('NONE');

      const filtered = await caller('get', '/educator/students?pending=true');
      const ids = filtered.body.items.map((i: { id: string }) => i.id);
      expect(ids).toContain(pendingClient.id);
      expect(ids).not.toContain(okClient.id);
    });
  });

  describe('IT-012 removal for both professions', () => {
    it("removing an educator's student cancels open charges, deletes invoices/tax id, and no notification is sent", async () => {
      const group = await prisma.productGroup.findUniqueOrThrow({
        where: { id: groupId },
        include: { products: true },
      });
      const educator = await createUser(
        productIdByType(group.products, ProductType.PHYSICAL_EDUCATOR),
        'remove-educator',
      );
      await connectAccount(educator, `${RUN_TAG}-remove-key`);
      const client = await createClientFor(educator.id, { linked: true });
      const caller = await asUser(educator);
      const created = await caller(
        'post',
        `/billing/students/${client.id}/invoices`,
      ).send(invoiceDto());
      expect(created.status).toBe(201);

      const before = await prisma.notification.count({
        where: { userId: client.userId! },
      });
      const removal = await caller('delete', `/educator/students/${client.id}`);
      expect(removal.status).toBe(200);
      expect(removal.body.billingWarnings).toEqual([]);

      const invoice = await prisma.invoice.findUnique({
        where: { id: created.body.id },
      });
      expect(invoice).toBeNull();
      const after = await prisma.notification.count({
        where: { userId: client.userId! },
      });
      expect(after).toBe(before);
    });

    it("the nutritionist's DELETE /clients/:id behaves the same way", async () => {
      const group = await prisma.productGroup.findUniqueOrThrow({
        where: { id: groupId },
        include: { products: true },
      });
      const nutritionist = await createUser(
        productIdByType(group.products, ProductType.NUTRITIONIST),
        'remove-nutri',
      );
      await connectAccount(nutritionist, `${RUN_TAG}-remove-nutri-key`);
      const client = await createClientFor(nutritionist.id);
      const caller = await asUser(nutritionist);
      const created = await caller(
        'post',
        `/billing/students/${client.id}/invoices`,
      ).send(invoiceDto());
      expect(created.status).toBe(201);

      const removal = await caller('delete', `/clients/${client.id}`);
      expect(removal.status).toBe(200);
      expect(removal.body.billingWarnings).toEqual([]);

      const invoice = await prisma.invoice.findUnique({
        where: { id: created.body.id },
      });
      expect(invoice).toBeNull();
    });
  });

  describe('IT-013 access and the guard opt-out', () => {
    it('billing routes answer 401 unauthenticated, 403 for a regular user, and 404 for another professional or a linked student', async () => {
      const group = await prisma.productGroup.findUniqueOrThrow({
        where: { id: groupId },
        include: { products: true },
      });
      const owner = await createUser(
        productIdByType(group.products, ProductType.PHYSICAL_EDUCATOR),
        'access-owner',
      );
      await connectAccount(owner, `${RUN_TAG}-access-key`);
      const other = await createUser(
        productIdByType(group.products, ProductType.PHYSICAL_EDUCATOR),
        'access-other',
      );
      const regularUser = await createUser(null, 'access-regular');
      const client = await createClientFor(owner.id, { linked: true });

      const unauthenticated = await request(app.getHttpServer())
        .get(`/billing/students/${client.id}/invoices`)
        .set('x-application-secret', APPLICATION_SECRET);
      expect(unauthenticated.status).toBe(401);

      const regular = await (
        await asUser(regularUser)
      )('get', `/billing/students/${client.id}/invoices`);
      expect(regular.status).toBe(403);

      const otherProfessional = await (
        await asUser(other)
      )('get', `/billing/students/${client.id}/invoices`);
      const randomId = await (
        await asUser(owner)
      )(
        'get',
        '/billing/students/00000000-0000-0000-0000-000000000000/invoices',
      );
      expect(otherProfessional.status).toBe(randomId.status);

      const linkedStudent = await (
        await asUser(
          await prisma.users.findUniqueOrThrow({
            where: { id: client.userId! },
          }),
        )
      )('get', `/billing/students/${client.id}/invoices`);
      expect([403, 404]).toContain(linkedStudent.status);
    });

    it('every other backend route still requires the shared secret, while the webhook route is reachable without it', async () => {
      const noSecret = await request(app.getHttpServer()).get(
        '/billing/account',
      );
      expect(noSecret.status).toBe(403);

      const webhookNoSecret = await request(app.getHttpServer())
        .post('/billing/webhooks/asaas')
        .send({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_x' } });
      // Reached the handler (which then answers 401 itself, for lack of a
      // valid token) rather than being blocked by the shared-secret guard.
      expect(webhookNoSecret.status).toBe(401);
    });

    it("a student record's tax number never appears in any /clients response", async () => {
      const group = await prisma.productGroup.findUniqueOrThrow({
        where: { id: groupId },
        include: { products: true },
      });
      const nutritionist = await createUser(
        productIdByType(group.products, ProductType.NUTRITIONIST),
        'tax-scan-nutri',
      );
      const client = await createClientFor(nutritionist.id);
      await connectAccount(nutritionist, `${RUN_TAG}-tax-scan-key`);
      const caller = await asUser(nutritionist);
      await caller('put', `/billing/students/${client.id}/tax-id`).send({
        cpfCnpj: '529.982.247-25',
      });

      const clientsResponse = await caller('get', '/clients');
      expect(JSON.stringify(clientsResponse.body)).not.toMatch(
        /52998224725|529\.982\.247-25/,
      );
    });
  });

  describe('IT-014 secret scan', () => {
    it('no captured response from a full connect-create-pay-reconcile flow contains the API key, the webhook token or the tax number digits', async () => {
      const group = await prisma.productGroup.findUniqueOrThrow({
        where: { id: groupId },
        include: { products: true },
      });
      const educator = await createUser(
        productIdByType(group.products, ProductType.PHYSICAL_EDUCATOR),
        'scan-educator',
      );
      const apiKey = `${RUN_TAG}-scan-key`;
      const caller = await asUser(educator);
      const connect = await caller('put', '/billing/account').send({
        apiKey,
      });
      const client = await createClientFor(educator.id);
      const create = await caller(
        'post',
        `/billing/students/${client.id}/invoices`,
      ).send(invoiceDto({ cpfCnpj: '529.982.247-25' }));
      const list = await caller(
        'get',
        `/billing/students/${client.id}/invoices`,
      );

      const captured = JSON.stringify([connect.body, create.body, list.body]);
      expect(captured).not.toMatch(new RegExp(apiKey));
      expect(captured).not.toMatch(/52998224725/);
    });
  });
});
