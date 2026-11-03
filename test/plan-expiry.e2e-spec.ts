import { AcademiaProvisioningService } from '@/academia/academia.service';
import { createValidationPipe } from '@/config/validationPipe';
import { AuthGuard } from '@/auth/auth.guard';
import { PAYMENT_GATEWAY } from '@/billing/gateway/paymentGateway';
import { TemplatesService } from '@/clinical-records/templates/templates.service';
import { ApiKeyGuard } from '@/common/guards/apiKey.guard';
import { PrismaService } from '@/database/prisma.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { ProfileController } from '@/users/profile/profile.controller';
import { ProfileService } from '@/users/profile/profile.service';
import { SubscriptionController } from '@/users/subscription/subscription.controller';
import { SubscriptionService } from '@/users/subscription/subscription.service';
import { PLATFORM_ASAAS_API_KEY } from '@/users/subscription/platformGateway.tokens';
import { UploadService } from '@/utils/upload.service';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const MARKER = 'plan-expiry-e2e';
const applicationSecret = 'plan-expiry-e2e-secret';
const jwtSecret = 'plan-expiry-e2e-jwt-secret';

const PERIOD_END = new Date('2026-10-18T03:00:00.000Z');
const CANCEL_AT = new Date('2026-10-10T03:00:00.000Z');

describe('plan expiry — expiresAt and autoRenew on the real endpoints', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let freeProductId: string;
  let paidProductId: string;
  let requestIndex = 0;
  const createdUserIds: string[] = [];
  const temporaryProductIds: string[] = [];
  let temporaryGroupId: string | null = null;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = jwtSecret;

    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: jwtSecret })],
      controllers: [ProfileController, SubscriptionController],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        ProductsRepository,
        ProfileService,
        SubscriptionService,
        Clock,
        AuthGuard,
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        {
          provide: AcademiaProvisioningService,
          useValue: { provisionForOwner: jest.fn() },
        },
        {
          provide: TemplatesService,
          useValue: { ensureStarterTemplates: jest.fn() },
        },
        {
          provide: PAYMENT_GATEWAY,
          useValue: {
            createSubscriptionCheckout: jest.fn(),
            updateSubscription: jest.fn().mockResolvedValue(undefined),
            createCharge: jest.fn(),
          },
        },
        { provide: PLATFORM_ASAAS_API_KEY, useValue: 'test-platform-key' },
        {
          provide: UploadService,
          useValue: { getSignedUrl: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'APPLICATION_SECRET' ? applicationSecret : undefined,
          },
        },
        { provide: APP_GUARD, useClass: ApiKeyGuard },
      ],
    }).compile();

    app = module.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = module.get(PrismaService);
    jwtService = module.get(JwtService);

    // Reuse the catalog when the database is seeded; otherwise add throwaway
    // rows that afterAll removes, so the catalog is left as it was found.
    const freeProduct = await prisma.product.findFirst({
      where: { type: 'USER', price: 0 },
    });
    freeProductId = freeProduct
      ? freeProduct.id
      : await createTemporaryProduct('Gratuito', 0);

    const paidProduct = await prisma.product.findFirst({
      where: { type: 'USER', price: { gt: 0 } },
    });
    paidProductId = paidProduct
      ? paidProduct.id
      : await createTemporaryProduct('Premium', 29.9);
  });

  async function createTemporaryProduct(name: string, price: number) {
    if (!temporaryGroupId) {
      const group = await prisma.productGroup.create({
        data: { name: `${MARKER} group` },
      });
      temporaryGroupId = group.id;
    }
    const product = await prisma.product.create({
      data: { name, price, type: 'USER', groupId: temporaryGroupId },
    });
    temporaryProductIds.push(product.id);
    return product.id;
  }

  afterEach(async () => {
    if (createdUserIds.length === 0) {
      return;
    }
    const ids = createdUserIds.splice(0, createdUserIds.length);
    await prisma.usersToken.deleteMany({ where: { userID: { in: ids } } });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
  });

  afterAll(async () => {
    if (prisma) {
      if (temporaryProductIds.length > 0) {
        await prisma.product.deleteMany({
          where: { id: { in: temporaryProductIds } },
        });
      }
      if (temporaryGroupId) {
        await prisma.productGroup.delete({ where: { id: temporaryGroupId } });
      }
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function createUser(
    caseId: string,
    data: {
      productId: string;
      subscriptionStatus?: string | null;
      subscriptionCancelAt?: Date | null;
      subscriptionCurrentPeriodEnd?: Date | null;
    },
  ) {
    const user = await prisma.users.create({
      data: {
        name: 'Plan Expiry E2E',
        email: `${caseId}-${Date.now()}-${++requestIndex}@${MARKER}.test`,
        password: 'hash',
        active: true,
        asaasCustomerId: `cus_${MARKER}_${requestIndex}`,
        asaasSubscriptionId: `sub_${MARKER}_${requestIndex}`,
        ...data,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  const tokenFor = (user: { id: string; email: string }) =>
    jwtService.signAsync({ id: user.id, email: user.email });

  it('IT-006 derives expiresAt and autoRenew on GET /profile for every plan state', async () => {
    const profileOf = async (user: { id: string; email: string }) => {
      const response = await request(app.getHttpServer())
        .get('/profile')
        .set('x-application-secret', applicationSecret)
        .set('Authorization', `Bearer ${await tokenFor(user)}`)
        .expect(200);
      return response.body as { expiresAt: string | null; autoRenew: boolean };
    };

    const renewing = await profileOf(
      await createUser('it-006-renewing', {
        productId: paidProductId,
        subscriptionStatus: 'active',
        subscriptionCancelAt: null,
        subscriptionCurrentPeriodEnd: PERIOD_END,
      }),
    );
    expect(renewing.expiresAt).toBe(PERIOD_END.toISOString());
    expect(renewing.autoRenew).toBe(true);

    const cancelled = await profileOf(
      await createUser('it-006-cancelled', {
        productId: paidProductId,
        subscriptionStatus: 'active',
        subscriptionCancelAt: CANCEL_AT,
        subscriptionCurrentPeriodEnd: PERIOD_END,
      }),
    );
    expect(cancelled.expiresAt).toBe(CANCEL_AT.toISOString());
    expect(cancelled.autoRenew).toBe(false);

    // Gratuito: stale subscription columns must not produce a date.
    const free = await profileOf(
      await createUser('it-006-free', {
        productId: freeProductId,
        subscriptionStatus: 'active',
        subscriptionCancelAt: null,
        subscriptionCurrentPeriodEnd: PERIOD_END,
      }),
    );
    expect(free.expiresAt).toBeNull();
    expect(free.autoRenew).toBe(false);

    const noPeriodEnd = await profileOf(
      await createUser('it-006-no-period-end', {
        productId: paidProductId,
        subscriptionStatus: 'active',
        subscriptionCancelAt: null,
        subscriptionCurrentPeriodEnd: null,
      }),
    );
    expect(noPeriodEnd.expiresAt).toBeNull();
    expect(noPeriodEnd.autoRenew).toBe(true);

    await request(app.getHttpServer())
      .get('/profile')
      .set('x-application-secret', applicationSecret)
      .expect(401);
  });

  it('IT-007 returns expiresAt and autoRenew true after reactivating', async () => {
    const user = await createUser('it-007', {
      productId: paidProductId,
      subscriptionStatus: 'active',
      subscriptionCancelAt: CANCEL_AT,
      subscriptionCurrentPeriodEnd: PERIOD_END,
    });

    const response = await request(app.getHttpServer())
      .patch('/users/subscription/reactivate')
      .set('x-application-secret', applicationSecret)
      .set('Authorization', `Bearer ${await tokenFor(user)}`)
      .expect(200);

    const body = response.body as {
      expiresAt: string | null;
      autoRenew: boolean;
    };
    expect(body.expiresAt).toBe(PERIOD_END.toISOString());
    expect(body.autoRenew).toBe(true);
  });
});
