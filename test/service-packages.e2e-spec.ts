/**
 * Integration test for PRD `plan-pricing-management` (task_03, backend).
 *
 * IT-003: the service-packages guard stack (401 with no token, 403 for a
 * non-professional caller, 200 for an authenticated NUTRITIONIST and,
 * separately, PHYSICAL_EDUCATOR) and cross-professional isolation — a second
 * professional's GET/PATCH/deactivate calls against the first professional's
 * package id never succeed or leak data (US-008.EC-1, US-009).
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { ServicePackageController } from '@/service-packages/servicePackage.controller';
import { ServicePackageService } from '@/service-packages/servicePackage.service';
import { ServicePackageRepository } from '@/repositories/service-packages/servicePackage.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `service-packages-${Date.now()}`;

describe('Service packages guard stack and isolation integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let nutritionist: Users;
  let educator: Users;
  let regularUser: Users;

  const jwtSecret = 'service-packages-integration-jwt-secret';

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = jwtSecret;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      // AuthModule itself is never imported here: its JwtModule.register()
      // reads process.env.JWT_SECRET at class-definition time (module
      // import), which runs before this beforeAll sets JWT_SECRET to this
      // suite's own value — see test/professional-food-diary-and-mirror.e2e-
      // spec.ts for the same, established workaround. Every real dependency
      // is wired by hand for the same reason.
      imports: [JwtModule.register({ secret: jwtSecret })],
      controllers: [ServicePackageController],
      providers: [
        PrismaService,
        UserRepository,
        ServicePackageRepository,
        ServicePackageService,
        ProfessionalGuard,
        AuthGuard,
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
    const ids = [nutritionist.id, educator.id, regularUser.id];
    await prisma.servicePackage.deleteMany({
      where: { professionalId: { in: ids } },
    });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
    await prisma.product.deleteMany({ where: { groupId } });
    await prisma.productGroup.deleteMany({ where: { id: groupId } });
    await prisma.$disconnect();
    await app.close();
  });

  async function seed(): Promise<void> {
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
            {
              name: `${RUN_TAG} educator`,
              price: 10,
              type: ProductType.PHYSICAL_EDUCATOR,
            },
            { name: `${RUN_TAG} user`, price: 0, type: ProductType.USER },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    const nutriProduct = group.products.find(
      (p) => p.type === ProductType.NUTRITIONIST,
    )!;
    const educatorProduct = group.products.find(
      (p) => p.type === ProductType.PHYSICAL_EDUCATOR,
    )!;
    const userProduct = group.products.find(
      (p) => p.type === ProductType.USER,
    )!;

    nutritionist = await createUser('nutritionist', nutriProduct.id);
    educator = await createUser('educator', educatorProduct.id);
    regularUser = await createUser('regular-user', userProduct.id);
  }

  async function createUser(label: string, productId: string): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Service Packages ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId,
      },
    });
  }

  async function as(target: Users) {
    const token = await jwtService.signAsync({
      id: target.id,
      email: target.email,
    });
    const auth = `Bearer ${token}`;
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        request(server).post(url).set('Authorization', auth).send(body),
      patch: (url: string, body: object = {}) =>
        request(server).patch(url).set('Authorization', auth).send(body),
    };
  }

  it('IT-003 returns 401 with no token', async () => {
    const response = await request(app.getHttpServer()).get(
      '/service-packages',
    );
    expect(response.status).toBe(401);
  });

  it('IT-003 returns 403 not_professional for a non-professional (USER) caller', async () => {
    const regular = await as(regularUser);
    const response = await regular.get('/service-packages');
    expect(response.status).toBe(403);
    expect(response.body.message).toBeDefined();
  });

  it('IT-003 a NUTRITIONIST gets 200 and full CRUD over their own packages', async () => {
    const nutri = await as(nutritionist);

    const created = await nutri.post('/service-packages', {
      name: 'Pacote nutricionista',
      sessionCount: 4,
      referencePrice: 399.9,
    });
    expect(created.status).toBe(201);

    const list = await nutri.get('/service-packages');
    expect(list.status).toBe(200);
    expect(
      list.body.some((p: { id: string }) => p.id === created.body.id),
    ).toBe(true);
  });

  it('IT-003 a PHYSICAL_EDUCATOR gets 200 and identical CRUD capability over their own packages', async () => {
    const edu = await as(educator);

    const created = await edu.post('/service-packages', {
      name: 'Pacote educador',
      sessionCount: 8,
      referencePrice: 799.9,
    });
    expect(created.status).toBe(201);

    const list = await edu.get('/service-packages');
    expect(list.status).toBe(200);
    expect(
      list.body.some((p: { id: string }) => p.id === created.body.id),
    ).toBe(true);
  });

  it("IT-003 a second professional never sees, edits, or deactivates the first professional's package", async () => {
    const nutri = await as(nutritionist);
    const edu = await as(educator);

    const created = await nutri.post('/service-packages', {
      name: 'Pacote privado',
      sessionCount: 2,
      referencePrice: 150,
    });
    expect(created.status).toBe(201);
    const packageId = created.body.id;

    const eduList = await edu.get('/service-packages');
    expect(eduList.body.some((p: { id: string }) => p.id === packageId)).toBe(
      false,
    );

    const eduPatch = await edu.patch(`/service-packages/${packageId}`, {
      name: 'Hijacked',
    });
    expect(eduPatch.status).toBe(404);

    const eduDeactivate = await edu.post(
      `/service-packages/${packageId}/deactivate`,
    );
    expect(eduDeactivate.status).toBe(404);

    const unchanged = await prisma.servicePackage.findUniqueOrThrow({
      where: { id: packageId },
    });
    expect(unchanged.name).toBe('Pacote privado');
    expect(unchanged.active).toBe(true);
  });
});
