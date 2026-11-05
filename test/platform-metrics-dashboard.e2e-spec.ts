/**
 * Integration tests for PRD `platform-metrics-dashboard` (task_01, backend).
 *
 * Runs the real MetricsController/Service, UserRepository, AuthGuard,
 * BackofficeGuard and AdminTierGuard against an isolated database.
 * `AsaasGateway` is replaced by a `PAYMENT_GATEWAY` jest.fn() stub (its own
 * unit tests already cover the HTTP boundary — this suite never calls real
 * Asaas) so IT-004/IT-005 can drive the success/degraded cases directly.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { PAYMENT_GATEWAY } from '@/billing/gateway/paymentGateway';
import { AdminTierGuard } from '@/common/guards/adminTier.guard';
import { BackofficeGuard } from '@/common/guards/backoffice.guard';
import { MetricsController } from '@/backoffice/metrics/metrics.controller';
import { MetricsService } from '@/backoffice/metrics/metrics.service';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { PLATFORM_ASAAS_API_KEY } from '@/users/subscription/platformGateway.tokens';
import { startOfMonth, startOfPreviousMonth } from '@/utils/monthRange';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BackofficeTier,
  ProductTier,
  ProductType,
  Users,
} from '@prisma/client';
import request from 'supertest';

jest.setTimeout(60_000);

const RUN_TAG = `platform-metrics-${Date.now()}`;
const FAKE_PLATFORM_API_KEY = 'fake-platform-asaas-key';

// Fixed, independent of the real wall clock, so this suite's month
// boundaries (and MetricsService's 15-minute Asaas cache) never depend on
// what day it actually is when the suite runs.
const REFERENCE_NOW = new Date('2026-11-04T00:00:00.000Z');

describe('Platform metrics dashboard — GET /backoffice/metrics', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  const jwtSecret = 'platform-metrics-integration-jwt-secret';
  const createdUserIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdGroupIds: string[] = [];
  const listPayments = jest.fn();
  // MetricsService caches a successful Asaas read for 15 minutes — this
  // fake Clock lets each test step the service's "now" forward past that
  // window on demand (see `freshMetrics` below), so every call in this
  // suite reads live rather than silently hitting a previous test's cache.
  let currentNow = new Date(REFERENCE_NOW);
  const clock = { now: () => currentNow };

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = jwtSecret;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: jwtSecret })],
      controllers: [MetricsController],
      providers: [
        PrismaService,
        UserRepository,
        MetricsService,
        AuthGuard,
        BackofficeGuard,
        AdminTierGuard,
        { provide: PAYMENT_GATEWAY, useValue: { listPayments } },
        { provide: PLATFORM_ASAAS_API_KEY, useValue: FAKE_PLATFORM_API_KEY },
        { provide: Clock, useValue: clock },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await prisma.users.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.product.deleteMany({
      where: { id: { in: createdProductIds } },
    });
    await prisma.productGroup.deleteMany({
      where: { id: { in: createdGroupIds } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  async function createProduct(
    type: ProductType,
    tier: ProductTier,
    price: number,
  ) {
    const group = await prisma.productGroup.create({
      data: { name: `${RUN_TAG}-${type}-${tier}-group` },
    });
    createdGroupIds.push(group.id);
    const product = await prisma.product.create({
      data: {
        name: `${RUN_TAG}-${type}-${tier}`,
        price,
        type,
        tier,
        groupId: group.id,
      },
    });
    createdProductIds.push(product.id);
    return product;
  }

  async function createUser(
    label: string,
    overrides: Partial<{
      isBackoffice: boolean;
      backofficeTier: BackofficeTier | null;
      productId: string | null;
      subscriptionStatus: string | null;
      subscriptionCancelAt: Date | null;
      createdAt: Date;
    }> = {},
  ): Promise<Users> {
    const user = await prisma.users.create({
      data: {
        name: `User ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        isBackoffice: overrides.isBackoffice ?? false,
        backofficeTier: overrides.backofficeTier ?? null,
        productId: overrides.productId ?? null,
        subscriptionStatus: overrides.subscriptionStatus ?? null,
        subscriptionCancelAt: overrides.subscriptionCancelAt ?? null,
        ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function bearerFor(user: Users): Promise<string> {
    const token = await jwtService.signAsync({
      id: user.id,
      email: user.email,
    });
    return `Bearer ${token}`;
  }

  async function asUser(user: Users) {
    const auth = await bearerFor(user);
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set('Authorization', auth),
    };
  }

  interface MetricsBody {
    mrr: { current: number; previousMonth: number | null; asOf: string };
    registeredByRole: {
      role: string;
      free: number;
      premium: number;
      newThisMonth: number;
    }[];
    churnByRole: { role: string; canceledThisMonth: number }[];
  }

  // Always steps the fake Clock past MetricsService's 15-minute cache
  // window first, so this call is guaranteed to read (or attempt to read)
  // Asaas live rather than returning another test's cached value.
  async function freshMetrics(caller: {
    get: (url: string) => request.Test;
  }): Promise<{ status: number; body: MetricsBody }> {
    currentNow = new Date(currentNow.getTime() + 20 * 60_000);
    const response = await caller.get('/backoffice/metrics');
    return { status: response.status, body: response.body as MetricsBody };
  }

  describe('guard stack', () => {
    it('IT-001 rejects a request with no Authorization header', async () => {
      const response = await request(app.getHttpServer()).get(
        '/backoffice/metrics',
      );

      expect(response.status).toBe(401);
    });

    it('IT-002 rejects a BackofficeTier.EQUIPE staff member', async () => {
      const equipe = await asUser(
        await createUser('it002-equipe', {
          isBackoffice: true,
          backofficeTier: BackofficeTier.EQUIPE,
        }),
      );

      const response = await equipe.get('/backoffice/metrics');

      // AdminTierGuard throws AppError (not CodedError) — its `reason`
      // ('not_admin_interno') is deliberately internal-only, per AppError's
      // own contract (src/utils/app.erro.ts): never serialized into the
      // client-facing response body. Only the status is observable here,
      // same as every other AppError-guarded route (error-monitoring's own
      // IT-002/IT-003 precedent).
      expect(response.status).toBe(403);
    });

    it('IT-003 rejects a non-backoffice user', async () => {
      const plain = await asUser(await createUser('it003-plain'));

      const response = await plain.get('/backoffice/metrics');

      expect(response.status).toBe(403);
    });
  });

  describe('data correctness', () => {
    async function seedDataset(labelPrefix: string) {
      const thisMonth = new Date(
        startOfMonth(REFERENCE_NOW).getTime() + 2 * 86_400_000,
      );
      const lastMonth = new Date(
        startOfPreviousMonth(REFERENCE_NOW).getTime() + 2 * 86_400_000,
      );

      const userFree = await createProduct(
        ProductType.USER,
        ProductTier.FREE,
        0,
      );
      const userPremium = await createProduct(
        ProductType.USER,
        ProductTier.PREMIUM,
        19.9,
      );
      const nutriFree = await createProduct(
        ProductType.NUTRITIONIST,
        ProductTier.FREE,
        0,
      );
      const nutriPremium = await createProduct(
        ProductType.NUTRITIONIST,
        ProductTier.PREMIUM,
        79.9,
      );
      const educatorPremium = await createProduct(
        ProductType.PHYSICAL_EDUCATOR,
        ProductTier.PREMIUM,
        59.9,
      );
      const academiaPremium = await createProduct(
        ProductType.ACADEMIA,
        ProductTier.PREMIUM,
        149.9,
      );

      await createUser(`${labelPrefix}-u1`, {
        productId: userFree.id,
        subscriptionStatus: 'active',
        createdAt: lastMonth,
      });
      await createUser(`${labelPrefix}-u2`, {
        productId: userPremium.id,
        subscriptionStatus: 'active',
        createdAt: thisMonth,
      });
      await createUser(`${labelPrefix}-u3`, {
        productId: userPremium.id,
        subscriptionStatus: 'active',
        createdAt: lastMonth,
        subscriptionCancelAt: thisMonth,
      });
      await createUser(`${labelPrefix}-u4`, {
        productId: nutriPremium.id,
        subscriptionStatus: 'active',
        createdAt: thisMonth,
      });
      await createUser(`${labelPrefix}-u5`, {
        productId: nutriFree.id,
        subscriptionStatus: 'active',
        createdAt: lastMonth,
      });
      // Canceled this same month, then reactivated: subscriptionCancelAt is
      // cleared back to null — must not count as a cancellation (UT-006,
      // US-003.EC-1), proven here against a real database's NULL semantics.
      await createUser(`${labelPrefix}-u6`, {
        productId: educatorPremium.id,
        subscriptionStatus: 'active',
        createdAt: lastMonth,
        subscriptionCancelAt: null,
      });
      await createUser(`${labelPrefix}-u7`, {
        productId: academiaPremium.id,
        subscriptionStatus: 'active',
        createdAt: thisMonth,
      });
      // Registered, but not an active paid state — excluded from MRR, still
      // counted in registeredByRole (US-002.EC-2: every user has exactly
      // one product regardless of subscription status).
      await createUser(`${labelPrefix}-u8`, {
        productId: userPremium.id,
        subscriptionStatus: 'canceled',
        createdAt: lastMonth,
      });
    }

    function findRole<T extends { role: string }>(
      items: T[],
      role: string,
    ): T | undefined {
      return items.find((item) => item.role === role);
    }

    // Both IT-004 and IT-005 compare a "before" and "after" read around
    // their own seeding, asserting the *delta* rather than an absolute
    // count. This test database is a shared, persistent fixture (reused
    // across local/CI runs, not recreated per run) — scoping every
    // assertion to what this test itself added is what makes these
    // immune to any other suite's pre-existing or leftover Users rows.
    function delta(
      after: MetricsBody,
      before: MetricsBody,
      role: string,
      field: 'free' | 'premium' | 'newThisMonth',
    ): number {
      return (
        (findRole(after.registeredByRole, role)?.[field] ?? 0) -
        (findRole(before.registeredByRole, role)?.[field] ?? 0)
      );
    }

    function churnDelta(
      after: MetricsBody,
      before: MetricsBody,
      role: string,
    ): number {
      return (
        (findRole(after.churnByRole, role)?.canceledThisMonth ?? 0) -
        (findRole(before.churnByRole, role)?.canceledThisMonth ?? 0)
      );
    }

    it('IT-004 returns registeredByRole/churnByRole/mrr matching the seeded data exactly, Asaas succeeding', async () => {
      const admin = await asUser(
        await createUser('it004-admin', {
          isBackoffice: true,
          backofficeTier: BackofficeTier.ADMIN,
        }),
      );
      listPayments.mockResolvedValue(1);
      const { body: before } = await freshMetrics(admin);

      await seedDataset('it004');
      listPayments.mockResolvedValue(250.75);
      const { status, body: after } = await freshMetrics(admin);

      expect(status).toBe(200);
      expect(after.mrr.current - before.mrr.current).toBeCloseTo(329.5, 5);
      expect(after.mrr.previousMonth).toBe(250.75);

      expect(delta(after, before, 'USER', 'free')).toBe(1);
      expect(delta(after, before, 'USER', 'premium')).toBe(3);
      expect(delta(after, before, 'USER', 'newThisMonth')).toBe(1);

      expect(delta(after, before, 'NUTRITIONIST', 'free')).toBe(1);
      expect(delta(after, before, 'NUTRITIONIST', 'premium')).toBe(1);
      expect(delta(after, before, 'NUTRITIONIST', 'newThisMonth')).toBe(1);

      expect(delta(after, before, 'PHYSICAL_EDUCATOR', 'free')).toBe(0);
      expect(delta(after, before, 'PHYSICAL_EDUCATOR', 'premium')).toBe(1);
      expect(delta(after, before, 'PHYSICAL_EDUCATOR', 'newThisMonth')).toBe(0);

      expect(delta(after, before, 'ACADEMIA', 'free')).toBe(0);
      expect(delta(after, before, 'ACADEMIA', 'premium')).toBe(1);
      expect(delta(after, before, 'ACADEMIA', 'newThisMonth')).toBe(1);

      expect(churnDelta(after, before, 'USER')).toBe(1);
      // Reactivated within the month (u6): never counted (UT-006).
      expect(churnDelta(after, before, 'PHYSICAL_EDUCATOR')).toBe(0);
    });

    it('IT-005 still returns 200 with correct local figures when Asaas fails, previousMonth null', async () => {
      const admin = await asUser(
        await createUser('it005-admin', {
          isBackoffice: true,
          backofficeTier: BackofficeTier.ADMIN,
        }),
      );
      listPayments.mockResolvedValue(1);
      const { body: before } = await freshMetrics(admin);

      await seedDataset('it005');
      listPayments.mockRejectedValue(new Error('asaas unreachable'));
      const { status, body: after } = await freshMetrics(admin);

      expect(status).toBe(200);
      expect(after.mrr.previousMonth).toBeNull();
      expect(after.mrr.current - before.mrr.current).toBeCloseTo(329.5, 5);
      expect(delta(after, before, 'USER', 'premium')).toBe(3);
      expect(churnDelta(after, before, 'USER')).toBe(1);
    });
  });
});
