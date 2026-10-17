/**
 * Integration tests for PRD `nutritionist-module` (task_05, backend).
 *
 * IT-006: the professional-facing food-diary read endpoint, real Postgres.
 * IT-007: the nutritionist mirror's full response (anamnese, assessment
 * history with BMI, meal-plan version history), real Postgres.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { MailModule } from '@/mail/mail.module';
import { MealPlansService } from '@/meal-plans/mealPlans.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { ClientRegisterService } from '@/clients/register/client.register.service';
import { MealPlansRepository } from '@/repositories/meal-plans/mealPlans.repository';
import { FormRecordsRepository } from '@/repositories/clinical-records/formRecords.repository';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { ProfessionalFoodDiaryController } from '@/professional-food-diary/professionalFoodDiary.controller';
import { ProfessionalFoodDiaryService } from '@/professional-food-diary/professionalFoodDiary.service';
import { ProfessionalMirrorController } from '@/professional-mirror/professionalMirror.controller';
import { ProfessionalMirrorService } from '@/professional-mirror/professionalMirror.service';
import { ProfessionalDiscoveryService } from '@/professional-discovery/professionalDiscovery.service';
import { ProfessionalDiscoveryRepository } from '@/repositories/professional-discovery/professionalDiscovery.repository';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { MealsRepository } from '@/repositories/food-diary/meals.repository';
import { WaterLogRepository } from '@/repositories/food-diary/waterLog.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { FixedSessionsService } from '@/scheduling/fixed-times/fixedSessions.service';
import { Clock } from '@/scheduling/clock.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Client, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `pro-food-mirror-${Date.now()}`;

describe('Professional food-diary reads and nutritionist mirror integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let nutritionistA: Users;
  let nutritionistB: Users;

  const jwtSecret = 'pro-food-mirror-integration-jwt-secret';

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
      // reads process.env.JWT_SECRET at class-definition time (module import),
      // which runs before this beforeAll sets JWT_SECRET to this suite's own
      // value — see test/meal-plans.e2e-spec.ts for the same, established
      // workaround. Every other real feature dependency is wired by hand for
      // the same reason: importing ProfessionalDiscoveryModule/ClientsModule
      // would drag AuthModule in transitively.
      imports: [JwtModule.register({ secret: jwtSecret }), MailModule],
      controllers: [
        ProfessionalFoodDiaryController,
        ProfessionalMirrorController,
      ],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        EmploymentRepository,
        MealsRepository,
        WaterLogRepository,
        ProfessionalFoodDiaryService,
        ProfessionalGuard,
        AuthGuard,
        ProfessionalDiscoveryRepository,
        ClientRegisterService,
        NotificationsRepository,
        NotificationsService,
        ProfessionalDiscoveryService,
        FormRecordsRepository,
        EducatorWorkoutsRepository,
        MealPlansRepository,
        MealPlansService,
        {
          provide: FixedSessionsService,
          useValue: {
            nextForRecords: jest.fn().mockResolvedValue(new Map()),
            todaySessionId: jest.fn().mockResolvedValue(null),
          },
        },
        Clock,
        ProfessionalMirrorService,
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
    const ids = [nutritionistA.id, nutritionistB.id];
    await prisma.client.deleteMany({ where: { professionalId: { in: ids } } });
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

    nutritionistA = await prisma.users.create({
      data: {
        name: 'Nutri A',
        email: `${RUN_TAG}-a@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId: group.products[0].id,
      },
    });
    nutritionistB = await prisma.users.create({
      data: {
        name: 'Nutri B',
        email: `${RUN_TAG}-b@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId: group.products[0].id,
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
    };
  }

  async function makePatientUser(label: string): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Paciente ${label}`,
        email: `${RUN_TAG}-${label}@patient.test`,
        password: 'unused-in-integration-test',
        active: true,
      },
    });
  }

  async function linkedClient(
    professionalId: string,
    patient: Users,
  ): Promise<Client> {
    return await prisma.client.create({
      data: {
        name: patient.name,
        email: patient.email,
        phone: '',
        professionalId,
        userId: patient.id,
      },
    });
  }

  it('IT-006 a linked nutritionist sees real food-diary entries immediately; an unrelated nutritionist gets 404', async () => {
    const patient = await makePatientUser('it006');
    const client = await linkedClient(nutritionistA.id, patient);

    await prisma.meal.create({
      data: {
        userId: patient.id,
        mealType: 'LUNCH',
        description: 'Arroz, feijão e frango',
        calories: 650,
        loggedAt: new Date('2026-10-15T12:00:00.000Z'),
      },
    });
    await prisma.waterLog.create({
      data: {
        userId: patient.id,
        date: new Date('2026-10-15T00:00:00.000Z'),
        count: 3,
      },
    });

    const a = await as(nutritionistA);
    const seen = await a.get(`/professionals/clients/${client.id}/food-diary`);
    expect(seen.status).toBe(200);
    expect(seen.body.hasAccount).toBe(true);
    expect(seen.body.meals).toHaveLength(1);
    expect(seen.body.meals[0]).toMatchObject({
      description: 'Arroz, feijão e frango',
      calories: 650,
    });
    expect(seen.body.waterLogs).toHaveLength(1);

    const b = await as(nutritionistB);
    const denied = await b.get(
      `/professionals/clients/${client.id}/food-diary`,
    );
    expect(denied.status).toBe(404);
    expect(denied.body.code).toBe('client_not_found');

    await prisma.meal.deleteMany({ where: { userId: patient.id } });
    await prisma.waterLog.deleteMany({ where: { userId: patient.id } });
    await prisma.users.delete({ where: { id: patient.id } });
  });

  it('a Client with no linked account returns the distinct unlinked-empty state', async () => {
    const unlinked = await prisma.client.create({
      data: {
        name: 'Sem conta',
        email: `${RUN_TAG}-unlinked@client.test`,
        phone: '',
        professionalId: nutritionistA.id,
      },
    });

    const a = await as(nutritionistA);
    const response = await a.get(
      `/professionals/clients/${unlinked.id}/food-diary`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      hasAccount: false,
      meals: [],
      waterLogs: [],
    });
  });

  it("IT-007 a fully-seeded patient's mirror returns every section populated and correct", async () => {
    const patient = await makePatientUser('it007');
    const client = await linkedClient(nutritionistA.id, patient);

    const anamneseTemplate = await prisma.assessmentTemplate.create({
      data: {
        professionalId: nutritionistA.id,
        name: 'Anamnese',
        purpose: 'ANAMNESE',
        fields: {
          create: [{ position: 0, label: 'Objetivo', fieldType: 'SHORT_TEXT' }],
        },
      },
    });
    await prisma.formRecord.create({
      data: {
        clientId: client.id,
        templateId: anamneseTemplate.id,
        recordedByUserId: nutritionistA.id,
        values: {
          create: [
            {
              position: 0,
              fieldLabel: 'Objetivo',
              fieldType: 'SHORT_TEXT',
              textValue: 'Emagrecimento saudável',
            },
          ],
        },
      },
    });

    const assessmentTemplate = await prisma.assessmentTemplate.create({
      data: {
        professionalId: nutritionistA.id,
        name: 'Avaliação',
        purpose: 'ASSESSMENT',
        fields: {
          create: [
            {
              position: 0,
              label: 'Peso (kg)',
              fieldType: 'NUMBER',
              weightRole: true,
            },
            {
              position: 1,
              label: 'Altura (cm)',
              fieldType: 'NUMBER',
              heightRole: true,
            },
          ],
        },
      },
    });
    for (const weight of [80, 78]) {
      await prisma.formRecord.create({
        data: {
          clientId: client.id,
          templateId: assessmentTemplate.id,
          recordedByUserId: nutritionistA.id,
          values: {
            create: [
              {
                position: 0,
                fieldLabel: 'Peso (kg)',
                fieldType: 'NUMBER',
                weightRole: true,
                numberValue: weight,
              },
              {
                position: 1,
                fieldLabel: 'Altura (cm)',
                fieldType: 'NUMBER',
                heightRole: true,
                numberValue: 175,
              },
            ],
          },
        },
      });
    }

    const draft = await prisma.mealPlan.create({
      data: {
        clientId: client.id,
        status: 'DRAFT',
        days: {
          create: [
            {
              weekday: 'MONDAY',
              meals: {
                create: [
                  { position: 0, label: 'Almoço', text: 'Arroz e feijão' },
                ],
              },
            },
          ],
        },
      },
    });
    await prisma.mealPlan.update({
      where: { id: draft.id },
      data: { status: 'PUBLISHED', version: 1, publishedAt: new Date() },
    });
    const draft2 = await prisma.mealPlan.create({
      data: {
        clientId: client.id,
        status: 'DRAFT',
        days: {
          create: [
            {
              weekday: 'MONDAY',
              meals: {
                create: [
                  { position: 0, label: 'Almoço', text: 'Salada e peixe' },
                ],
              },
            },
          ],
        },
      },
    });
    await prisma.mealPlan.update({
      where: { id: draft2.id },
      data: { status: 'PUBLISHED', version: 2, publishedAt: new Date() },
    });

    const patientSession = await as(patient);
    const mirror = await patientSession.get('/me/nutritionist');

    expect(mirror.status).toBe(200);
    expect(mirror.body.anamnese).toMatchObject({
      values: [
        expect.objectContaining({
          fieldLabel: 'Objetivo',
          value: 'Emagrecimento saudável',
        }),
      ],
    });
    expect(mirror.body.assessmentHistory).toHaveLength(2);
    const bmis = mirror.body.assessmentHistory.map(
      (r: { bmi: { value: number } }) => r.bmi.value,
    );
    expect(bmis.sort((a: number, b: number) => a - b)).toEqual([25.5, 26.1]);
    expect(mirror.body.mealPlan.currentVersion).toBe(2);
    expect(mirror.body.mealPlan.days[0].meals[0]).toMatchObject({
      text: 'Salada e peixe',
    });
    expect(
      mirror.body.mealPlan.versions.map((v: { version: number }) => v.version),
    ).toEqual([2, 1]);

    const pastVersion = await patientSession.get(
      '/me/nutritionist/meal-plan/versions/1',
    );
    expect(pastVersion.status).toBe(200);
    expect(pastVersion.body.version).toBe(1);
    expect(pastVersion.body.days[0].meals[0]).toMatchObject({
      text: 'Arroz e feijão',
    });

    const missingVersion = await patientSession.get(
      '/me/nutritionist/meal-plan/versions/99',
    );
    expect(missingVersion.status).toBe(404);
    expect(missingVersion.body.code).toBe('meal_plan_version_not_found');

    await prisma.client.delete({ where: { id: client.id } });
    await prisma.assessmentTemplate.deleteMany({
      where: { professionalId: nutritionistA.id },
    });
    await prisma.users.delete({ where: { id: patient.id } });
  });

  it('getNutritionistMealPlanVersion answers 404 for a patient with no linked nutritionist', async () => {
    const patient = await makePatientUser('noLink');

    const response = await (
      await as(patient)
    ).get('/me/nutritionist/meal-plan/versions/1');

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('meal_plan_version_not_found');

    await prisma.users.delete({ where: { id: patient.id } });
  });
});
