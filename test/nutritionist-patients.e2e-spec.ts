/**
 * Integration tests for PRD `nutritionist-module` (task_03, backend).
 *
 * Runs the real NutritionistPatientsController/Service, AuthGuard,
 * NutritionistGuard, and the app's global ValidationPipe against an isolated
 * database.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { NutritionistGuard } from '@/common/guards/nutritionist.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { NutritionistPatientsController } from '@/nutritionist-patients/nutritionistPatients.controller';
import { NutritionistPatientsService } from '@/nutritionist-patients/nutritionistPatients.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `nutri-patients-${Date.now()}`;

describe('Nutritionist patients integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clientsRepo: ClientsRepository;
  let jwtService: JwtService;
  let groupId: string;
  let nutritionistA: Users;
  let nutritionistB: Users;

  const jwtSecret = 'nutritionist-patients-integration-jwt-secret';

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
      controllers: [NutritionistPatientsController],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        NutritionistGuard,
        NutritionistPatientsService,
        AuthGuard,
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    clientsRepo = moduleFixture.get(ClientsRepository);
    jwtService = moduleFixture.get(JwtService);

    await seed();
  });

  afterEach(async () => {
    await prisma.client.deleteMany({
      where: { professionalId: { in: [nutritionistA.id, nutritionistB.id] } },
    });
  });

  afterAll(async () => {
    const ids = [nutritionistA.id, nutritionistB.id];
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
    await prisma.users.deleteMany({
      where: { email: { startsWith: `${RUN_TAG}-late` } },
    });
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
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    const nutriProduct = group.products[0];

    nutritionistA = await createUser('nutri-a', { productId: nutriProduct.id });
    nutritionistB = await createUser('nutri-b', { productId: nutriProduct.id });
  }

  async function createUser(
    label: string,
    extra: Partial<Prisma.UsersUncheckedCreateInput>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Nutri ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        ...extra,
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
    };
  }

  it('IT-001 a patient registered unlinked auto-links when a matching account is later confirmed, and two nutritionists registering the same e-mail stay independent', async () => {
    const email = `${RUN_TAG}-late@integration.test`;
    const a = await as(nutritionistA);
    const b = await as(nutritionistB);

    const createdByA = await a.post('/nutritionist/patients', {
      name: 'Paciente Tardio',
      email,
    });
    expect(createdByA.status).toBe(201);
    expect(createdByA.body.hasAccount).toBe(false);

    const createdByB = await b.post('/nutritionist/patients', {
      name: 'Paciente Tardio (B)',
      email,
    });
    expect(createdByB.status).toBe(201);
    expect(createdByB.body.id).not.toBe(createdByA.body.id);

    // The account is created and activated later (confirmation/activation
    // always calls setAllClientUser with the confirmed email).
    const lateAccount = await prisma.users.create({
      data: {
        name: 'Paciente Tardio',
        email,
        password: 'unused-in-integration-test',
        active: true,
      },
    });
    await clientsRepo.setAllClientUser(lateAccount.id, email);

    const afterA = await a.get(`/nutritionist/patients/${createdByA.body.id}`);
    const afterB = await b.get(`/nutritionist/patients/${createdByB.body.id}`);
    expect(afterA.body.hasAccount).toBe(true);
    expect(afterA.body.userId).toBe(lateAccount.id);
    expect(afterB.body.hasAccount).toBe(true);
    expect(afterB.body.userId).toBe(lateAccount.id);

    await prisma.users.delete({ where: { id: lateAccount.id } });
  });

  it('registering with an email matching an already-confirmed account links immediately', async () => {
    const existing = await createUser('existing', {});
    const a = await as(nutritionistA);

    const created = await a.post('/nutritionist/patients', {
      name: 'Paciente Existente',
      email: existing.email,
    });

    expect(created.status).toBe(201);
    expect(created.body.hasAccount).toBe(true);
    expect(created.body.userId).toBe(existing.id);

    await prisma.users.delete({ where: { id: existing.id } });
  });

  it('rejects a duplicate e-mail for the same nutritionist with 409, lists/searches correctly, and scopes GET :id to the owner', async () => {
    const a = await as(nutritionistA);
    const b = await as(nutritionistB);

    const first = await a.post('/nutritionist/patients', {
      name: 'Paciente Único',
      email: `${RUN_TAG}-dup@integration.test`,
    });
    expect(first.status).toBe(201);

    const duplicate = await a.post('/nutritionist/patients', {
      name: 'Outro Nome',
      email: `${RUN_TAG}-dup@integration.test`,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('duplicate_patient_email');

    const incomplete = await a.post('/nutritionist/patients', {
      name: 'Sem contato',
    });
    expect(incomplete.status).toBe(400);

    const list = await a
      .get('/nutritionist/patients')
      .query({ search: 'único' });
    expect(list.body.items.map((p: { id: string }) => p.id)).toEqual([
      first.body.id,
    ]);

    const empty = await a
      .get('/nutritionist/patients')
      .query({ search: 'zzz-no-match' });
    expect(empty.body).toEqual({ items: [], total: 0 });

    expect(
      (await b.get(`/nutritionist/patients/${first.body.id}`)).status,
    ).toBe(404);
  });
});
