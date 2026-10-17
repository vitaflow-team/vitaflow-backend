/**
 * Regression test for a real route-collision bug (nutritionist-module
 * task_06): `GET /professionals/templates` was silently shadowed by
 * `ProfessionalSearchController`'s unconstrained `GET /professionals/:id`
 * (registered first in the app's module order), which matched "templates"
 * as an id and answered 404 "Profissional não encontrado." instead of the
 * real template list. Caught only by booting the full `AppModule` — every
 * other e2e test in this suite mounts `clinical-records` in isolation and
 * never exercises this collision.
 *
 * Requires `TEST_DATABASE_URL` pointing to an isolated, migrated database.
 */
import { AppModule } from '@/app.module';
import { PrismaService } from '@/database/prisma.service';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductType } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `professionals-route-order-${Date.now()}`;

describe('/professionals/* route registration order', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let nutritionistId: string;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);

    const group = await prisma.productGroup.create({
      data: {
        name: `${RUN_TAG} group`,
        products: {
          create: [
            {
              name: `${RUN_TAG} nutri`,
              price: 10,
              type: ProductType.NUTRITIONIST,
            },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;

    const user = await prisma.users.create({
      data: {
        name: 'Route Order Nutri',
        email: `${RUN_TAG}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId: group.products[0].id,
      },
    });
    nutritionistId = user.id;
  });

  afterAll(async () => {
    await prisma.users.delete({ where: { id: nutritionistId } });
    await prisma.product.deleteMany({ where: { groupId } });
    await prisma.productGroup.delete({ where: { id: groupId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('GET /professionals/templates reaches ProfessionalTemplatesController, not the :id route', async () => {
    const token = await jwtService.signAsync({
      id: nutritionistId,
      email: `${RUN_TAG}@integration.test`,
    });

    const response = await request(app.getHttpServer())
      .get('/professionals/templates?purpose=ANAMNESE')
      .set('Authorization', `Bearer ${token}`)
      .set('x-application-secret', process.env.APPLICATION_SECRET ?? '');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});
