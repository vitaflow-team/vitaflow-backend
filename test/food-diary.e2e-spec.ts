/**
 * Integration tests for PRD `food-diary` (task_03, backend).
 *
 * Runs the real FoodDiaryController/FoodDiaryService/repositories/AuthGuard
 * and the app's global ValidationPipe against an isolated database. Only
 * the OpenAI client is replaced with a mock (no automated test makes a
 * real network call) — everything else, including the pure calorie-goal
 * and streak functions, runs unmocked.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { MealsRepository } from '@/repositories/food-diary/meals.repository';
import { WaterLogRepository } from '@/repositories/food-diary/waterLog.repository';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { CalorieEstimationService } from '@/food-diary/calorieEstimation.service';
import { FoodDiaryController } from '@/food-diary/foodDiary.controller';
import { FoodDiaryService } from '@/food-diary/foodDiary.service';
import { OPENAI_CLIENT } from '@/workouts/openaiClient.provider';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(30_000);

const RUN_TAG = `fd-${Date.now()}`;

function completion(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

describe('Food Diary integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let user: Users;
  const openAiCreate = jest.fn();
  const jwtSecret = 'food-diary-integration-jwt-secret';

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
      controllers: [FoodDiaryController],
      providers: [
        PrismaService,
        UserRepository,
        MealsRepository,
        WaterLogRepository,
        FitnessProfileRepository,
        MeasurementRecordsRepository,
        CalorieEstimationService,
        FoodDiaryService,
        AuthGuard,
        {
          provide: OPENAI_CLIENT,
          useValue: { chat: { completions: { create: openAiCreate } } },
        },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);

    user = await prisma.users.create({
      data: {
        name: `Food Diary ${RUN_TAG}`,
        email: `${RUN_TAG}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        birthDate: new Date('1996-01-15'),
      },
    });
  });

  afterEach(async () => {
    await prisma.meal.deleteMany({ where: { userId: user.id } });
    await prisma.waterLog.deleteMany({ where: { userId: user.id } });
    openAiCreate.mockReset();
  });

  afterAll(async () => {
    await prisma.fitnessProfile.deleteMany({ where: { userId: user.id } });
    await prisma.measurementRecord.deleteMany({ where: { userId: user.id } });
    await prisma.users.delete({ where: { id: user.id } });
    await prisma.$disconnect();
    await app.close();
  });

  async function bearer(): Promise<string> {
    const token = await jwtService.signAsync({
      id: user.id,
      email: user.email,
    });
    return `Bearer ${token}`;
  }

  async function seedMeal(
    overrides: Partial<Prisma.MealUncheckedCreateInput> = {},
  ) {
    return await prisma.meal.create({
      data: {
        userId: user.id,
        mealType: 'LUNCH',
        description: `${RUN_TAG} meal`,
        calories: 500,
        ...overrides,
      },
    });
  }

  it('IT-001 persists the client-sent calories, not necessarily the raw estimate', async () => {
    const auth = await bearer();
    openAiCreate.mockResolvedValueOnce(completion({ calories: 300 }));

    const estimate = await request(app.getHttpServer())
      .post('/food-diary/estimate-calories')
      .set('Authorization', auth)
      .send({ description: '1 banana' });
    expect(estimate.body.calories).toBe(300);

    const logged = await request(app.getHttpServer())
      .post('/food-diary/meals')
      .set('Authorization', auth)
      .send({ mealType: 'SNACK', description: '1 banana', calories: 350 });

    expect(logged.status).toBe(201);
    expect(logged.body.calories).toBe(350);
  });

  it('IT-002 scopes the daily summary correctly per date with correct totals', async () => {
    const auth = await bearer();
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    await seedMeal({
      calories: 300,
      loggedAt: new Date(`${today}T09:00:00.000Z`),
    });
    await seedMeal({
      calories: 200,
      loggedAt: new Date(`${today}T19:00:00.000Z`),
    });
    await seedMeal({
      calories: 900,
      loggedAt: new Date(`${yesterday}T12:00:00.000Z`),
    });

    const todaySummary = await request(app.getHttpServer())
      .get(`/food-diary/summary?date=${today}`)
      .set('Authorization', auth);
    const yesterdaySummary = await request(app.getHttpServer())
      .get(`/food-diary/summary?date=${yesterday}`)
      .set('Authorization', auth);

    expect(todaySummary.body.totalCalories).toBe(500);
    expect(todaySummary.body.meals).toHaveLength(2);
    expect(yesterdaySummary.body.totalCalories).toBe(900);
    expect(yesterdaySummary.body.meals).toHaveLength(1);
  });

  it('IT-003 profile-status → submit missing fields → summary now shows a goal, and a real MeasurementRecord exists', async () => {
    const auth = await bearer();

    const before = await request(app.getHttpServer())
      .get('/food-diary/profile-status')
      .set('Authorization', auth);
    expect(before.body.missingFields.sort()).toEqual(['goal', 'sex']);

    await request(app.getHttpServer())
      .post('/food-diary/profile')
      .set('Authorization', auth)
      .send({ sex: 'MALE', goal: 'MAINTENANCE', weightKg: 80, heightCm: 180 });

    const today = new Date().toISOString().slice(0, 10);
    const summary = await request(app.getHttpServer())
      .get(`/food-diary/summary?date=${today}`)
      .set('Authorization', auth);

    expect(summary.body.goal).not.toBeNull();
    const record = await prisma.measurementRecord.findFirst({
      where: { userId: user.id },
    });
    expect(record?.weightKg).toBe(80);
    expect(record?.heightCm).toBe(180);
  });

  it('IT-004 allows the owning user to edit/delete, refuses a different user', async () => {
    const auth = await bearer();
    const otherUser = await prisma.users.create({
      data: {
        name: `Food Diary other ${RUN_TAG}`,
        email: `${RUN_TAG}-other@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
      },
    });
    const otherAuth = `Bearer ${await jwtService.signAsync({
      id: otherUser.id,
      email: otherUser.email,
    })}`;
    const meal = await seedMeal();

    const refusedEdit = await request(app.getHttpServer())
      .patch(`/food-diary/meals/${meal.id}`)
      .set('Authorization', otherAuth)
      .send({ calories: 999 });
    expect(refusedEdit.status).toBe(404);

    const allowedEdit = await request(app.getHttpServer())
      .patch(`/food-diary/meals/${meal.id}`)
      .set('Authorization', auth)
      .send({ calories: 999 });
    expect(allowedEdit.status).toBe(200);
    expect(allowedEdit.body.calories).toBe(999);

    const refusedDelete = await request(app.getHttpServer())
      .delete(`/food-diary/meals/${meal.id}`)
      .set('Authorization', otherAuth);
    expect(refusedDelete.status).toBe(404);

    const allowedDelete = await request(app.getHttpServer())
      .delete(`/food-diary/meals/${meal.id}`)
      .set('Authorization', auth);
    expect(allowedDelete.status).toBe(204);

    await prisma.users.delete({ where: { id: otherUser.id } });
  });

  it('IT-005 increments/decrements water and never drops below 0', async () => {
    const auth = await bearer();
    const today = new Date().toISOString().slice(0, 10);

    await request(app.getHttpServer())
      .post(`/food-diary/water?date=${today}`)
      .set('Authorization', auth);
    const afterTwo = await request(app.getHttpServer())
      .post(`/food-diary/water?date=${today}`)
      .set('Authorization', auth);
    expect(afterTwo.body.count).toBe(2);

    const afterOneDown = await request(app.getHttpServer())
      .delete(`/food-diary/water?date=${today}`)
      .set('Authorization', auth);
    expect(afterOneDown.body.count).toBe(1);

    await request(app.getHttpServer())
      .delete(`/food-diary/water?date=${today}`)
      .set('Authorization', auth);
    const floored = await request(app.getHttpServer())
      .delete(`/food-diary/water?date=${today}`)
      .set('Authorization', auth);
    expect(floored.body.count).toBe(0);
  });
});
