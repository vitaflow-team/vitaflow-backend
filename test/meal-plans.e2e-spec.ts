/**
 * Integration tests for PRD `nutritionist-module` (task_04, backend).
 *
 * Runs the real MealPlansController/Service, AuthGuard, ProfessionalGuard,
 * and the app's global ValidationPipe against an isolated database.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { MealPlansController } from '@/meal-plans/mealPlans.controller';
import { MealPlansService } from '@/meal-plans/mealPlans.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { MealPlansRepository } from '@/repositories/meal-plans/mealPlans.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Client, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `meal-plans-${Date.now()}`;

describe('Meal plans integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let nutritionist: Users;
  let patient: Client;

  const jwtSecret = 'meal-plans-integration-jwt-secret';

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
      controllers: [MealPlansController],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        MealPlansRepository,
        MealPlansService,
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
    await prisma.client.deleteMany({
      where: { professionalId: nutritionist.id },
    });
    await prisma.users.deleteMany({ where: { id: nutritionist.id } });
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

    nutritionist = await prisma.users.create({
      data: {
        name: `Nutri ${RUN_TAG}`,
        email: `${RUN_TAG}-nutri@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId: group.products[0].id,
      },
    });
    patient = await prisma.client.create({
      data: {
        name: 'Paciente IT-005',
        email: `${RUN_TAG}-patient@client.test`,
        phone: '',
        professionalId: nutritionist.id,
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
      put: (url: string, body: object) =>
        request(server).put(url).set('Authorization', auth).send(body),
    };
  }

  it('IT-005 a full two-cycle draft/save/clone/publish lifecycle, with v1 unchanged after v2', async () => {
    const n = await as(nutritionist);
    const base = `/professionals/clients/${patient.id}/meal-plan`;

    const draft = await n.get(`${base}/draft`);
    expect(draft.status).toBe(200);
    expect(draft.body.days).toEqual([]);

    const mon = await n.put(`${base}/draft/days/MONDAY`, {
      meals: [{ label: 'Café da manhã', text: 'Ovos e pão' }],
    });
    expect(mon.status).toBe(200);
    const wed = await n.put(`${base}/draft/days/WEDNESDAY`, {
      meals: [{ label: 'Almoço', text: 'Arroz, feijão e frango' }],
    });
    expect(wed.status).toBe(200);

    const mondayDayId = wed.body.days.find(
      (d: { weekday: string }) => d.weekday === 'MONDAY',
    ).id;
    const cloned = await n.post(`${base}/draft/days/FRIDAY/clone`, {
      sourceDayId: mondayDayId,
    });
    expect(cloned.status).toBe(201);
    const friday = cloned.body.days.find(
      (d: { weekday: string }) => d.weekday === 'FRIDAY',
    );
    expect(friday.meals).toEqual([
      expect.objectContaining({ label: 'Café da manhã', text: 'Ovos e pão' }),
    ]);

    const published1 = await n.post(`${base}/draft/publish`);
    expect(published1.status).toBe(201);
    expect(published1.body.version).toBe(1);

    // A new draft is auto-created only on the next access, pre-filled from v1.
    const draftAfterPublish = await n.get(`${base}/draft`);
    expect(draftAfterPublish.body.days).toHaveLength(3);

    const editedWed = await n.put(`${base}/draft/days/WEDNESDAY`, {
      meals: [{ label: 'Almoço', text: 'Salada e peixe grelhado' }],
    });
    expect(editedWed.status).toBe(200);

    const published2 = await n.post(`${base}/draft/publish`);
    expect(published2.status).toBe(201);
    expect(published2.body.version).toBe(2);

    const versions = await n.get(`${base}/versions`);
    expect(versions.body.map((v: { version: number }) => v.version)).toEqual([
      2, 1,
    ]);

    const v1 = await n.get(`${base}/versions/1`);
    const v1Wed = v1.body.days.find(
      (d: { weekday: string }) => d.weekday === 'WEDNESDAY',
    );
    expect(v1Wed.meals[0]).toMatchObject({ text: 'Arroz, feijão e frango' });

    const v2 = await n.get(`${base}/versions/2`);
    const v2Wed = v2.body.days.find(
      (d: { weekday: string }) => d.weekday === 'WEDNESDAY',
    );
    expect(v2Wed.meals[0]).toMatchObject({ text: 'Salada e peixe grelhado' });
  });

  it('rejects publishing an empty plan, and rejects an overwrite without confirmation', async () => {
    const other = await prisma.client.create({
      data: {
        name: 'Paciente Vazio',
        email: `${RUN_TAG}-empty@client.test`,
        phone: '',
        professionalId: nutritionist.id,
      },
    });
    const n = await as(nutritionist);
    const base = `/professionals/clients/${other.id}/meal-plan`;

    await n.get(`${base}/draft`);
    const emptyPublish = await n.post(`${base}/draft/publish`);
    expect(emptyPublish.status).toBe(400);
    expect(emptyPublish.body.code).toBe('empty_plan');

    const monday = await n.put(`${base}/draft/days/MONDAY`, {
      meals: [{ label: 'Almoço', text: 'Arroz' }],
    });
    expect(monday.status).toBe(200);
    const tuesday = await n.put(`${base}/draft/days/TUESDAY`, {
      meals: [{ label: 'Jantar', text: 'Sopa' }],
    });
    const mondayDayId = tuesday.body.days.find(
      (d: { weekday: string }) => d.weekday === 'MONDAY',
    ).id;

    const withoutConfirm = await n.post(`${base}/draft/days/TUESDAY/clone`, {
      sourceDayId: mondayDayId,
    });
    expect(withoutConfirm.status).toBe(409);
    expect(withoutConfirm.body.code).toBe('confirm_overwrite_required');

    const withConfirm = await n.post(`${base}/draft/days/TUESDAY/clone`, {
      sourceDayId: mondayDayId,
      confirmOverwrite: true,
    });
    expect(withConfirm.status).toBe(201);
    const confirmedTuesday = withConfirm.body.days.find(
      (d: { weekday: string }) => d.weekday === 'TUESDAY',
    );
    expect(confirmedTuesday.meals[0]).toMatchObject({
      label: 'Almoço',
      text: 'Arroz',
    });

    await prisma.client.delete({ where: { id: other.id } });
  });
});
