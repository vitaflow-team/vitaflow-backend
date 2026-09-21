import { ApiKeyGuard } from '@/common/guards/api-key.guard';
import { PrismaService } from '@/database/prisma.service';
import { PlansController } from '@/product/plans.controller';
import { ProductsService } from '@/product/product.service';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const applicationSecret = 'plans-e2e-secret';

type PlanResponse = {
  id: string;
  name: string;
  price: number;
  type: string;
  groupId: string;
  stripeId: string | null;
  productInfos: unknown[];
};

// The real ValidationPipe, the real ApiKeyGuard and the real repository over
// the test database — the point of these cases is that an invalid category
// never reaches Prisma and never turns into a 500.
describe('plan categories — GET /plans (integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

    const module = await Test.createTestingModule({
      controllers: [PlansController],
      providers: [
        PrismaService,
        ProductsRepository,
        ProductsService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'APPLICATION_SECRET' ? applicationSecret : undefined,
          },
        },
        // GET /plans carries no route guard of its own: it is protected by
        // the globally registered API-key guard, exactly like GET /products.
        { provide: APP_GUARD, useClass: ApiKeyGuard },
      ],
    }).compile();

    app = module.createNestApplication<App>();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
    prisma = module.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  const getPlans = (query = '') =>
    request(app.getHttpServer())
      .get(`/plans${query}`)
      .set('x-application-secret', applicationSecret);

  const isOrderedByPrice = (plans: PlanResponse[]) =>
    plans.every(
      (plan, index) =>
        index === 0 ||
        plans[index - 1].price < plan.price ||
        (plans[index - 1].price === plan.price &&
          plans[index - 1].name.localeCompare(plan.name) <= 0),
    );

  it('IT-001 returns every seeded plan ordered by price ascending', async () => {
    const stored = await prisma.product.count();

    const response = await getPlans().expect(200);
    const plans = response.body as PlanResponse[];

    expect(plans).toHaveLength(stored);
    expect(isOrderedByPrice(plans)).toBe(true);
    expect(plans[0]).toHaveProperty('productInfos');
  });

  it.each([
    ['USUARIO', 'USER'],
    ['NUTRICIONISTA', 'NUTRITIONIST'],
    ['EDUCADOR_FISICO', 'PHYSICAL_EDUCATOR'],
  ])(
    'IT-002 returns only %s plans, ordered by price',
    async (category, type) => {
      const response = await getPlans(`?category=${category}`).expect(200);
      const plans = response.body as PlanResponse[];

      expect(plans.every((plan) => plan.type === type)).toBe(true);
      expect(isOrderedByPrice(plans)).toBe(true);
      expect(plans).toHaveLength(
        await prisma.product.count({
          where: { type: type as 'USER' },
        }),
      );
    },
  );

  it.each([
    ['a wrongly cased name', '?category=nutricionista'],
    ['an empty value', '?category='],
    ['an unknown name', '?category=ADMIN'],
    ['a repeated parameter', '?category=USUARIO&category=NUTRICIONISTA'],
  ])('IT-003 answers 400, never 500, for %s', async (_label, query) => {
    const response = await getPlans(query);

    expect(response.status).toBe(400);
  });

  it('IT-004 rejects a request without the API-key header', async () => {
    await request(app.getHttpServer()).get('/plans').expect(403);
  });
});

// IT-005 is its own module: the empty category is produced by stubbing the
// repository, so the case does not depend on the catalog the test database
// happens to hold.
describe('plan categories — GET /plans with an empty category', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PlansController],
      providers: [
        ProductsService,
        {
          provide: ProductsRepository,
          useValue: { listPlans: jest.fn().mockResolvedValue([]) },
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
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('IT-005 returns 200 and an empty list', async () => {
    const response = await request(app.getHttpServer())
      .get('/plans?category=EDUCADOR_FISICO')
      .set('x-application-secret', applicationSecret)
      .expect(200);

    expect(response.body).toEqual([]);
  });
});
