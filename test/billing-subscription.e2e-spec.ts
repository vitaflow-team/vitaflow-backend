/**
 * Integration tests for PRD `educator-billing`, task 6 (ADR-010): the
 * platform's own Asaas subscription flow against a real migrated database
 * and the fake Asaas server.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AcademiaProvisioningService } from '@/academia/academia.service';
import { BillingModule } from '@/billing/billing.module';
import { TemplatesService } from '@/clinical-records/templates/templates.service';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { SubscriptionController } from '@/users/subscription/subscription.controller';
import { SubscriptionService } from '@/users/subscription/subscription.service';
import { SubscriptionWebhookController } from '@/users/subscription/subscriptionWebhook.controller';
import { SubscriptionWebhookService } from '@/users/subscription/subscriptionWebhook.service';
import {
  PLATFORM_ASAAS_API_KEY,
  PLATFORM_WEBHOOK_TOKEN,
} from '@/users/subscription/platformGateway.tokens';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductGroup } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { FAKE_KEYS, FakeAsaasServer } from './support/fakeAsaasServer';

jest.setTimeout(120_000);

const RUN_TAG = `billsub-${Date.now()}`;
const JWT_SECRET =
  process.env.JWT_SECRET ?? 'billing-subscription-jwt-secret-0123456789';
const WEBHOOK_TOKEN = 'billing-subscription-webhook-token';
const PLATFORM_KEY = FAKE_KEYS.valid;
const fake = new FakeAsaasServer();

describe('Platform subscription (integration, IT-030, IT-031)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;
  let group: ProductGroup;
  let freeProductId: string;
  let premiumProductId: string;
  let proProductId: string;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.BILLING_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
    process.env.API_PUBLIC_URL = 'https://api.vitaflow.test';
    await fake.start();
    process.env.ASAAS_BASE_URL = fake.baseUrl;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        JwtModule.register({ secret: JWT_SECRET }),
        BillingModule,
      ],
      controllers: [SubscriptionController, SubscriptionWebhookController],
      providers: [
        UserRepository,
        ClientsRepository,
        ProductsRepository,
        SubscriptionService,
        SubscriptionWebhookService,
        Clock,
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        {
          provide: AcademiaProvisioningService,
          useValue: { provisionForOwner: jest.fn() },
        },
        {
          provide: TemplatesService,
          useValue: { ensureStarterTemplates: jest.fn() },
        },
        { provide: PLATFORM_ASAAS_API_KEY, useValue: PLATFORM_KEY },
        { provide: PLATFORM_WEBHOOK_TOKEN, useValue: WEBHOOK_TOKEN },
      ],
    }).compile();

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwt = moduleFixture.get(JwtService);

    group = await prisma.productGroup.create({
      data: { name: `${RUN_TAG} group` },
    });
    const free = await prisma.product.create({
      data: { name: `${RUN_TAG} Gratuito`, price: 0, groupId: group.id },
    });
    freeProductId = free.id;
    const premium = await prisma.product.create({
      data: { name: `${RUN_TAG} Premium`, price: 29.9, groupId: group.id },
    });
    premiumProductId = premium.id;
    const pro = await prisma.product.create({
      data: { name: `${RUN_TAG} Pro`, price: 59.9, groupId: group.id },
    });
    proProductId = pro.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.users.deleteMany({
        where: { email: { endsWith: RUN_TAG } },
      });
      await prisma.product.deleteMany({ where: { groupId: group.id } });
      await prisma.productGroup.delete({ where: { id: group.id } });
      await prisma.$disconnect();
    }
    await app?.close();
    await fake.stop();
  });

  async function createUser(label: string) {
    const user = await prisma.users.create({
      data: {
        name: `Billing Subscription ${label}`,
        email: `${label}-${Date.now()}@${RUN_TAG}`,
        password: 'unused-in-integration-test',
        active: true,
        productId: freeProductId,
      },
    });
    const token = await jwt.signAsync({ id: user.id, email: user.email });
    return { user, token };
  }

  // IT-030: a user completes an Asaas Checkout for a plan -> the webhook
  // delivers CHECKOUT_PAID then SUBSCRIPTION_CREATED -> the user's Asaas
  // fields and subscriptionStatus sync correctly.
  it('IT-030 syncs asaasCustomerId/asaasSubscriptionId/productId/subscriptionStatus from the checkout + subscription webhooks', async () => {
    const { user, token } = await createUser('it-030');

    const checkoutResponse = await request(app.getHttpServer())
      .post('/users/subscription/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: premiumProductId })
      .expect(200);
    expect(checkoutResponse.body.link).toContain('checkoutSession');

    const customerId = `cus_${RUN_TAG}_030`;
    const subscriptionId = `sub_${RUN_TAG}_030`;

    await request(app.getHttpServer())
      .post('/users/subscription/webhook')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({
        event: 'CHECKOUT_PAID',
        checkout: {
          customer: customerId,
          externalReference: `${user.id}:${premiumProductId}`,
        },
      })
      .expect(200);

    await request(app.getHttpServer())
      .post('/users/subscription/webhook')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({
        event: 'SUBSCRIPTION_CREATED',
        subscription: {
          id: subscriptionId,
          customer: customerId,
          externalReference: `${user.id}:${premiumProductId}`,
        },
      })
      .expect(200);

    const synced = await prisma.users.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(synced).toMatchObject({
      asaasCustomerId: customerId,
      asaasSubscriptionId: subscriptionId,
      productId: premiumProductId,
      subscriptionStatus: 'active',
    });
  });

  // IT-031: a Premium plan upgrade mid-cycle issues exactly one adjustment
  // charge for the amount the proration formula computes, and the
  // subscription's own future charges reflect the new price.
  it('IT-031 a mid-cycle upgrade issues exactly one adjustment charge and updates the subscription value', async () => {
    const { user, token } = await createUser('it-031');
    const customerId = `cus_${RUN_TAG}_031`;
    const subscriptionId = `sub_${RUN_TAG}_031`;
    const periodEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 days remaining

    // Seed the subscription on the fake server itself, mirroring what a
    // real checkout completion would have created.
    fake.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      value: 29.9,
      status: 'ACTIVE',
    });
    await prisma.users.update({
      where: { id: user.id },
      data: {
        productId: premiumProductId,
        asaasCustomerId: customerId,
        asaasSubscriptionId: subscriptionId,
        subscriptionStatus: 'active',
        subscriptionCurrentPeriodEnd: periodEnd,
      },
    });

    const chargesBefore = fake.charges.size;

    const response = await request(app.getHttpServer())
      .patch('/users/subscription/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: proProductId })
      .expect(200);

    expect(response.body).toMatchObject({
      productId: proProductId,
      subscriptionStatus: 'active',
    });

    // Exactly one new charge, for the proration delta: (5990 - 2990) *
    // (10/30) rounded to whole cents = 1000.
    const newCharges = [...fake.charges.values()].slice(chargesBefore);
    expect(newCharges).toHaveLength(1);
    expect(Math.round(newCharges[0].value * 100)).toBe(1000);

    const subscription = fake.subscriptions.get(subscriptionId);
    expect(subscription?.value).toBe(59.9);

    const stored = await prisma.users.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stored.productId).toBe(proProductId);
  });
});
