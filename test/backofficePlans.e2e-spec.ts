/**
 * Integration tests for PRD `plan-pricing-management` (task_02, backend).
 *
 * Runs the real backoffice `PlansController`/`PlansService`, the public
 * `PlansController` (src/product/), `ProductsRepository`, `AuthGuard`,
 * `BackofficeGuard`, `AdminTierGuard` and the app's global ValidationPipe
 * against an isolated database.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { AdminTierGuard } from '@/common/guards/adminTier.guard';
import { BackofficeGuard } from '@/common/guards/backoffice.guard';
import { PlansController as BackofficePlansController } from '@/backoffice/plans/plans.controller';
import { PlansService } from '@/backoffice/plans/plans.service';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { PlansController as PublicPlansController } from '@/product/plans.controller';
import { ProductsService } from '@/product/product.service';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { BackofficeTier, Product, ProductGroup, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `plan-pricing-backoffice-${Date.now()}`;

describe('Backoffice plans integration (plan-pricing-management, task_02)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let group: ProductGroup;
  let seedProduct: Product;
  let adminUser: Users;
  let equipeUser: Users;
  let regularUser: Users;
  let subscriber: Users;
  const jwtSecret = 'plan-pricing-backoffice-integration-jwt-secret';
  const createdUserIds: string[] = [];
  const createdProductIds: string[] = [];

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
      controllers: [BackofficePlansController, PublicPlansController],
      providers: [
        PrismaService,
        UserRepository,
        ProductsRepository,
        PlansService,
        ProductsService,
        AuthGuard,
        BackofficeGuard,
        AdminTierGuard,
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);

    await seed();
  });

  afterAll(async () => {
    await prisma.users.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.product.deleteMany({
      where: { id: { in: createdProductIds } },
    });
    await prisma.product.deleteMany({ where: { groupId: group.id } });
    await prisma.productGroup.delete({ where: { id: group.id } });
    await prisma.$disconnect();
    await app.close();
  });

  async function seed(): Promise<void> {
    group = await prisma.productGroup.create({
      data: { name: `${RUN_TAG} group` },
    });
    seedProduct = await prisma.product.create({
      data: {
        groupId: group.id,
        name: `${RUN_TAG} seed product`,
        price: 29.9,
        type: 'USER',
        active: true,
      },
    });
    createdProductIds.push(seedProduct.id);

    adminUser = await createUser('admin', {
      isBackoffice: true,
      backofficeTier: BackofficeTier.ADMIN,
    });
    equipeUser = await createUser('equipe', {
      isBackoffice: true,
      backofficeTier: BackofficeTier.EQUIPE,
    });
    regularUser = await createUser('regular', {});
    subscriber = await createUser('subscriber', {
      productId: seedProduct.id,
    });
  }

  async function createUser(
    label: string,
    extra: Record<string, unknown>,
  ): Promise<Users> {
    const user = await prisma.users.create({
      data: {
        name: `Backoffice Plans ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        ...extra,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function bearerFor(target: Users): Promise<string> {
    const token = await jwtService.signAsync({
      id: target.id,
      email: target.email,
    });
    return `Bearer ${token}`;
  }

  function asGuest() {
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url),
      post: (url: string, body: object = {}) =>
        request(server).post(url).send(body),
    };
  }

  async function asUser(target: Users) {
    const auth = await bearerFor(target);
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        request(server).post(url).set('Authorization', auth).send(body),
    };
  }

  describe('IT-001 guard stack across both backoffice tiers', () => {
    it('401 with no token on the read route', async () => {
      const guest = asGuest();
      const response = await guest.get('/backoffice/plans');
      expect(response.status).toBe(401);
    });

    it('403 for a non-backoffice caller', async () => {
      const regular = await asUser(regularUser);
      const response = await regular.get('/backoffice/plans');
      expect(response.status).toBe(403);
    });

    it('200 for EQUIPE on the read-only list', async () => {
      const equipe = await asUser(equipeUser);
      const response = await equipe.get('/backoffice/plans');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('403 for EQUIPE attempting to create', async () => {
      const equipe = await asUser(equipeUser);
      const response = await equipe.post('/backoffice/plans', {
        groupId: group.id,
        name: 'Blocked',
        price: 10,
        type: 'USER',
        tier: 'STANDARD',
      });
      expect(response.status).toBe(403);
    });

    it('403 for EQUIPE attempting to reprice', async () => {
      const equipe = await asUser(equipeUser);
      const response = await equipe.post(
        `/backoffice/plans/${seedProduct.id}/reprice`,
        { price: 99 },
      );
      expect(response.status).toBe(403);
    });

    it('403 for EQUIPE attempting to deactivate', async () => {
      const equipe = await asUser(equipeUser);
      const response = await equipe.post(
        `/backoffice/plans/${seedProduct.id}/deactivate`,
      );
      expect(response.status).toBe(403);
    });

    it('200 for ADMIN on every route including mutations', async () => {
      const admin = await asUser(adminUser);

      const list = await admin.get('/backoffice/plans');
      expect(list.status).toBe(200);

      const created = await admin.post('/backoffice/plans', {
        groupId: group.id,
        name: `${RUN_TAG} admin-created`,
        price: 15,
        type: 'USER',
        tier: 'STANDARD',
      });
      expect(created.status).toBe(201);
      createdProductIds.push((created.body as { id: string }).id);

      const deactivated = await admin.post(
        `/backoffice/plans/${(created.body as { id: string }).id}/deactivate`,
      );
      expect(deactivated.status).toBe(201);
    });
  });

  describe('IT-002 full reprice cycle end to end', () => {
    it("reprices the seeded product; the subscriber's own resolved price is unchanged; GET /plans shows only the new price", async () => {
      const admin = await asUser(adminUser);

      const reprice = await admin.post(
        `/backoffice/plans/${seedProduct.id}/reprice`,
        { price: 49.9 },
      );
      expect(reprice.status).toBe(201);
      const repricedBody = reprice.body as {
        id: string;
        price: number;
        active: boolean;
      };
      expect(repricedBody.price).toBe(49.9);
      expect(repricedBody.active).toBe(true);
      expect(repricedBody.id).not.toBe(seedProduct.id);
      createdProductIds.push(repricedBody.id);

      // The subscriber's own Users.productId reference, and that product
      // row's price, are completely unchanged by the reprice.
      const refreshedSubscriber = await prisma.users.findUniqueOrThrow({
        where: { id: subscriber.id },
      });
      expect(refreshedSubscriber.productId).toBe(seedProduct.id);
      const originalProduct = await prisma.product.findUniqueOrThrow({
        where: { id: seedProduct.id },
      });
      expect(originalProduct.price).toBe(29.9);
      expect(originalProduct.active).toBe(false);

      // A fresh public GET /plans call shows only the new, active product
      // for this role/tier — the old one no longer appears. This test
      // module registers no global ApiKeyGuard, so the route is reachable
      // directly (the real app still gates it, unchanged by this PRD).
      const guestPlans = await asGuest().get('/plans');
      expect(guestPlans.status).toBe(200);
      const ids = (guestPlans.body as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain(repricedBody.id);
      expect(ids).not.toContain(seedProduct.id);
    });
  });
});
