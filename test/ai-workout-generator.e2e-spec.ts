/**
 * Integration tests for PRD `ai-workout-generator` (task_04, backend).
 *
 * Runs the real WorkoutsController/WorkoutsService/repositories/AuthGuard
 * and the app's global ValidationPipe against an isolated database. Only
 * the OpenAI client is replaced with a mock (per this feature's own rule:
 * no automated test makes a real network call) — everything else,
 * including the deterministic RuleEngineService, runs unmocked.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { WorkoutsRepository } from '@/repositories/workouts/workouts.repository';
import { ConversationStore } from '@/workouts/conversationStore';
import { LlmExplanationService } from '@/workouts/llmExplanation.service';
import { OPENAI_CLIENT } from '@/workouts/openaiClient.provider';
import { RuleEngineService } from '@/workouts/ruleEngine.service';
import { WorkoutsController } from '@/workouts/workouts.controller';
import { WorkoutsService } from '@/workouts/workouts.service';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Exercise,
  ExerciseEquipment,
  Prisma,
  ProductType,
  Users,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(30_000);

const RUN_TAG = `aiwg-${Date.now()}`;

function completion(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

describe('AI Workout Generator integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let freeUser: Users;
  let premiumUser: Users;
  let premiumGroupId: string;
  const openAiCreate = jest.fn();
  const jwtSecret = 'ai-workout-generator-integration-jwt-secret';

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
      controllers: [WorkoutsController],
      providers: [
        PrismaService,
        UserRepository,
        ExercisesRepository,
        FitnessProfileRepository,
        WorkoutsRepository,
        RuleEngineService,
        LlmExplanationService,
        ConversationStore,
        WorkoutsService,
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

    await seedUsers();
  });

  afterEach(async () => {
    await prisma.workout.deleteMany({
      where: { userId: { in: [freeUser.id, premiumUser.id] } },
    });
    await prisma.exercise.deleteMany({
      where: { name: { startsWith: RUN_TAG } },
    });
    openAiCreate.mockReset();
  });

  afterAll(async () => {
    const userIds = [freeUser, premiumUser].filter(Boolean).map((u) => u.id);
    await prisma.fitnessProfile.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
    await prisma.product.deleteMany({ where: { groupId: premiumGroupId } });
    await prisma.productGroup.deleteMany({ where: { id: premiumGroupId } });
    await prisma.$disconnect();
    await app.close();
  });

  async function seedUsers(): Promise<void> {
    const group = await prisma.productGroup.create({
      data: {
        name: `${RUN_TAG} premium group`,
        products: {
          create: {
            name: `${RUN_TAG} premium`,
            price: 49,
            type: ProductType.USER,
          },
        },
      },
      include: { products: true },
    });
    premiumGroupId = group.id;

    freeUser = await createUser('free', {});
    premiumUser = await createUser('premium', {
      productId: group.products[0].id,
      subscriptionStatus: 'active',
    });
  }

  async function createUser(
    label: string,
    extra: Partial<Prisma.UsersUncheckedCreateInput>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `AI Workout ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        birthDate: new Date('1990-01-01'),
        healthDataConsentAt: new Date(),
        ...extra,
      },
    });
  }

  async function bearer(user: Users): Promise<string> {
    const token = await jwtService.signAsync({
      id: user.id,
      email: user.email,
    });
    return `Bearer ${token}`;
  }

  async function seedExercise(
    overrides: Partial<Prisma.ExerciseUncheckedCreateInput> = {},
  ): Promise<Exercise> {
    return await prisma.exercise.create({
      data: {
        description: 'Seeded for integration tests.',
        muscleGroup: 'Peito',
        equipment: ExerciseEquipment.GYM,
        contraindications: [],
        ...overrides,
        name: `${RUN_TAG} ${overrides.name ?? 'Exercise'}`,
      },
    });
  }

  it('IT-001 progresses through each required field to completion over repeated POST /workouts/conversation calls', async () => {
    await seedExercise({ name: 'Supino' });
    const auth = await bearer(freeUser);

    const start = await request(app.getHttpServer())
      .post('/workouts/conversation')
      .set('Authorization', auth)
      .send({});
    expect(start.status).toBe(201);
    expect(start.body.field).toBe('sex');
    const { conversationId } = start.body;

    openAiCreate.mockResolvedValueOnce(
      completion({
        answers: { sex: 'MALE' },
        field: 'goal',
        question: 'Qual seu objetivo?',
        done: false,
        reprompt: false,
      }),
    );
    const afterSex = await request(app.getHttpServer())
      .post('/workouts/conversation')
      .set('Authorization', auth)
      .send({ conversationId, answer: 'masculino' });
    expect(afterSex.body.field).toBe('goal');

    openAiCreate.mockResolvedValueOnce(
      completion({
        answers: { sex: 'MALE', goal: 'MUSCLE_GAIN' },
        field: 'daysPerWeek',
        question: 'Quantos dias?',
        done: false,
        reprompt: false,
      }),
    );
    const afterGoal = await request(app.getHttpServer())
      .post('/workouts/conversation')
      .set('Authorization', auth)
      .send({ conversationId, answer: 'ganho de massa' });
    expect(afterGoal.body.field).toBe('daysPerWeek');
  });

  it('IT-002 leaves no Workout row for a conversation that is never completed', async () => {
    const auth = await bearer(freeUser);
    await request(app.getHttpServer())
      .post('/workouts/conversation')
      .set('Authorization', auth)
      .send({});

    const workouts = await prisma.workout.findMany({
      where: { userId: freeUser.id },
    });
    expect(workouts).toHaveLength(0);
  });

  it('IT-003 excludes the stated restriction and produces a non-empty explanation', async () => {
    const safe = await seedExercise({ name: 'Seguro', contraindications: [] });
    await seedExercise({
      name: 'Contraindicado',
      contraindications: ['SHOULDER'],
    });
    const auth = await bearer(freeUser);
    await prisma.fitnessProfile.upsert({
      where: { userId: freeUser.id },
      update: {
        goal: 'MUSCLE_GAIN',
        equipment: 'GYM',
        restrictions: ['SHOULDER'],
      },
      create: {
        userId: freeUser.id,
        goal: 'MUSCLE_GAIN',
        equipment: 'GYM',
        restrictions: ['SHOULDER'],
      },
    });

    openAiCreate.mockResolvedValueOnce(
      completion({ explanation: 'Plano evitando o ombro.' }),
    );
    const response = await request(app.getHttpServer())
      .post('/workouts/generate')
      .set('Authorization', auth)
      .send({ daysPerWeek: 1 });

    expect(response.status).toBe(201);
    expect(response.body.explanation).toBe('Plano evitando o ombro.');
    const exerciseIds = response.body.days.flatMap(
      (day: { exercises: { exercise: { id: string } }[] }) =>
        day.exercises.map((exercise) => exercise.exercise.id),
    );
    expect(exerciseIds).toContain(safe.id);
  });

  it('IT-004 gates regeneration behind Premium once a Workout exists, and allows a Premium regeneration', async () => {
    await seedExercise({ name: 'Genérico' });
    await prisma.fitnessProfile.upsert({
      where: { userId: freeUser.id },
      update: { goal: 'MUSCLE_GAIN', equipment: 'GYM', restrictions: [] },
      create: {
        userId: freeUser.id,
        goal: 'MUSCLE_GAIN',
        equipment: 'GYM',
        restrictions: [],
      },
    });
    await prisma.fitnessProfile.upsert({
      where: { userId: premiumUser.id },
      update: { goal: 'MUSCLE_GAIN', equipment: 'GYM', restrictions: [] },
      create: {
        userId: premiumUser.id,
        goal: 'MUSCLE_GAIN',
        equipment: 'GYM',
        restrictions: [],
      },
    });

    openAiCreate.mockResolvedValue(
      completion({ explanation: 'Plano inicial.' }),
    );
    const freeAuth = await bearer(freeUser);
    await request(app.getHttpServer())
      .post('/workouts/generate')
      .set('Authorization', freeAuth)
      .send({ daysPerWeek: 1 });

    const blocked = await request(app.getHttpServer())
      .post('/workouts/generate')
      .set('Authorization', freeAuth)
      .send({ daysPerWeek: 1 });
    expect(blocked.status).toBe(402);

    const premiumAuth = await bearer(premiumUser);
    await request(app.getHttpServer())
      .post('/workouts/generate')
      .set('Authorization', premiumAuth)
      .send({ daysPerWeek: 1 });
    const regenerated = await request(app.getHttpServer())
      .post('/workouts/generate')
      .set('Authorization', premiumAuth)
      .send({ daysPerWeek: 1 });
    expect(regenerated.status).toBe(201);
  });

  it('IT-005 returns the full nested workout, or an empty response when none exists', async () => {
    const auth = await bearer(freeUser);

    const empty = await request(app.getHttpServer())
      .get('/workouts/current')
      .set('Authorization', auth);
    expect(empty.body).toEqual({ workout: null });

    await seedExercise({ name: 'Para current' });
    await prisma.fitnessProfile.upsert({
      where: { userId: freeUser.id },
      update: { goal: 'MUSCLE_GAIN', equipment: 'GYM', restrictions: [] },
      create: {
        userId: freeUser.id,
        goal: 'MUSCLE_GAIN',
        equipment: 'GYM',
        restrictions: [],
      },
    });
    openAiCreate.mockResolvedValueOnce(completion({ explanation: 'Plano.' }));
    await request(app.getHttpServer())
      .post('/workouts/generate')
      .set('Authorization', auth)
      .send({ daysPerWeek: 1 });

    const withWorkout = await request(app.getHttpServer())
      .get('/workouts/current')
      .set('Authorization', auth);
    expect(withWorkout.body.workout.days.length).toBeGreaterThan(0);
  });

  it('IT-006 persists a manual exercise/sets/reps edit and reflects it on the next GET', async () => {
    const original = await seedExercise({ name: 'Original' });
    const replacement = await seedExercise({ name: 'Substituto' });
    const auth = await bearer(freeUser);
    await prisma.fitnessProfile.upsert({
      where: { userId: freeUser.id },
      update: { goal: 'MUSCLE_GAIN', equipment: 'GYM', restrictions: [] },
      create: {
        userId: freeUser.id,
        goal: 'MUSCLE_GAIN',
        equipment: 'GYM',
        restrictions: [],
      },
    });
    openAiCreate.mockResolvedValueOnce(completion({ explanation: 'Plano.' }));
    await request(app.getHttpServer())
      .post('/workouts/generate')
      .set('Authorization', auth)
      .send({ daysPerWeek: 1 });

    const current = await request(app.getHttpServer())
      .get('/workouts/current')
      .set('Authorization', auth);
    const workoutExerciseId = current.body.workout.days[0].exercises[0].id;

    const patched = await request(app.getHttpServer())
      .patch(`/workouts/exercises/${workoutExerciseId}`)
      .set('Authorization', auth)
      .send({ exerciseId: replacement.id, sets: 5, reps: 6 });
    expect(patched.status).toBe(200);

    const after = await request(app.getHttpServer())
      .get('/workouts/current')
      .set('Authorization', auth);
    const editedExercise = after.body.workout.days[0].exercises[0];
    expect(editedExercise.exercise.id).toBe(replacement.id);
    expect(editedExercise.exercise.id).not.toBe(original.id);
    expect(editedExercise.sets).toBe(5);
    expect(editedExercise.reps).toBe(6);
  });
});
