/**
 * Integration test for PRD `notifications` (task_02, backend) — IT-003.
 *
 * Runs the real SubscriptionService calling into the real
 * NotificationsService/NotificationsRepository against an isolated
 * database — module-level integration, not an HTTP call, since
 * `NotificationsService.create()` has no public route (TechSpec). Only
 * `MailService` and `StripeVerification` are mocked.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { MailService } from '@/mail/mail.service';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { NotificationsService } from '@/notifications/notifications.service';
import { PrismaService } from '@/database/prisma.service';
import { StripeVerification } from '@/utils/stripeVerification';
import { SubscriptionService } from '@/users/subscription/subscription.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductType, Users } from '@prisma/client';

jest.setTimeout(30_000);

const RUN_TAG = `notif-billing-${Date.now()}`;

describe('Notifications billing trigger integration (IT-003)', () => {
  let prisma: PrismaService;
  let subscriptionService: SubscriptionService;
  let user: Users;
  let productGroupId: string;
  let premiumProductId: string;
  const sendNotificationEmail = jest.fn();

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        UserRepository,
        ProductsRepository,
        NotificationsRepository,
        NotificationsService,
        SubscriptionService,
        { provide: MailService, useValue: { sendNotificationEmail } },
        {
          provide: StripeVerification,
          useValue: { verifySubscriptionWithStripe: jest.fn() },
        },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    prisma = moduleFixture.get(PrismaService);
    subscriptionService = moduleFixture.get(SubscriptionService);

    const group = await prisma.productGroup.create({
      data: {
        name: `${RUN_TAG} group`,
        products: {
          create: {
            name: `${RUN_TAG} premium`,
            price: 49,
            type: ProductType.USER,
          },
        },
      },
      include: { products: true },
    });
    productGroupId = group.id;
    premiumProductId = group.products[0].id;

    user = await prisma.users.create({
      data: {
        name: `Notifications Billing ${RUN_TAG}`,
        email: `${RUN_TAG}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId: premiumProductId,
        stripeCustomerId: `cus_${RUN_TAG}`,
        subscriptionStatus: 'active',
      },
    });
  });

  beforeEach(() => {
    sendNotificationEmail.mockReset();
  });

  afterEach(async () => {
    await prisma.notification.deleteMany({ where: { userId: user.id } });
    await prisma.notificationPreference.deleteMany({
      where: { userId: user.id },
    });
    await prisma.users.update({
      where: { id: user.id },
      data: { subscriptionStatus: 'active' },
    });
  });

  afterAll(async () => {
    await prisma.users.delete({ where: { id: user.id } });
    await prisma.product.deleteMany({ where: { groupId: productGroupId } });
    await prisma.productGroup.deleteMany({ where: { id: productGroupId } });
    await prisma.$disconnect();
  });

  it('IT-003 creates an in-app row and attempts an email when the BILLING preference is enabled (default)', async () => {
    await subscriptionService.syncFromWebhook({
      stripeCustomerId: user.stripeCustomerId!,
      stripePriceId: 'price_whatever',
      stripeSubscriptionId: 'sub_1',
      subscriptionStatus: 'past_due',
    });

    const rows = await prisma.notification.findMany({
      where: { userId: user.id, category: 'BILLING' },
    });
    expect(rows).toHaveLength(1);
    expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
  });

  it('IT-003 still creates the in-app row, but sends no email, when BILLING is disabled', async () => {
    await prisma.notificationPreference.create({
      data: { userId: user.id, category: 'BILLING', enabled: false },
    });

    await subscriptionService.syncFromWebhook({
      stripeCustomerId: user.stripeCustomerId!,
      stripePriceId: 'price_whatever',
      stripeSubscriptionId: 'sub_1',
      subscriptionStatus: 'past_due',
    });

    const rows = await prisma.notification.findMany({
      where: { userId: user.id, category: 'BILLING' },
    });
    expect(rows).toHaveLength(1);
    expect(sendNotificationEmail).not.toHaveBeenCalled();
  });
});
