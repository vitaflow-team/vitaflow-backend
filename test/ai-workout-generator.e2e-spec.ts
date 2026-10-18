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
import { PremiumGuard } from '@/common/guards/premium.guard';
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
import OpenAI from 'openai';
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
        PremiumGuard,
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

  it('IT-001 (revised) progresses through every required field — age, weight, height, sessionDuration, the LLM-driven fields, then restrictionDetail — over repeated POST /workouts/conversation calls', async () => {
    const freshUser = await createUser('fresh-flow', {});
    try {
      const auth = await bearer(freshUser);

      const start = await request(app.getHttpServer())
        .post('/workouts/conversation')
        .set('Authorization', auth)
        .send({});
      expect(start.status).toBe(201);
      expect(start.body.field).toBe('weight');
      const { conversationId } = start.body;

      const afterWeight = await request(app.getHttpServer())
        .post('/workouts/conversation')
        .set('Authorization', auth)
        .send({ conversationId, answer: '70' });
      expect(afterWeight.body.field).toBe('height');

      const afterHeight = await request(app.getHttpServer())
        .post('/workouts/conversation')
        .set('Authorization', auth)
        .send({ conversationId, answer: '170' });
      expect(afterHeight.body.field).toBe('sessionDuration');
      expect(openAiCreate).not.toHaveBeenCalled();

      openAiCreate.mockResolvedValueOnce(
        completion({
          answers: {
            sex: null,
            goal: null,
            daysPerWeek: null,
            equipment: null,
            restrictions: null,
            experienceLevel: null,
            muscleFocus: null,
          },
          field: 'sex',
          question: 'Qual é o seu sexo?',
          done: false,
          reprompt: false,
        }),
      );
      const afterSessionDuration = await request(app.getHttpServer())
        .post('/workouts/conversation')
        .set('Authorization', auth)
        .send({ conversationId, answer: '45' });
      expect(afterSessionDuration.body.field).toBe('sex');

      openAiCreate.mockResolvedValueOnce(
        completion({
          answers: {
            sex: 'MALE',
            goal: 'MUSCLE_GAIN',
            daysPerWeek: 3,
            equipment: 'GYM',
            restrictions: [],
            experienceLevel: 'BEGINNER',
            muscleFocus: 'NONE',
          },
          field: null,
          question: '',
          done: true,
          reprompt: false,
        }),
      );
      const afterLlmPhase = await request(app.getHttpServer())
        .post('/workouts/conversation')
        .set('Authorization', auth)
        .send({
          conversationId,
          answer:
            'masculino, ganho de massa, 3 dias, academia, sem restrições, iniciante, sem preferência',
        });
      expect(afterLlmPhase.body.field).toBe('restrictionDetail');
      expect(afterLlmPhase.body.optional).toBe(true);
    } finally {
      await prisma.fitnessProfile.deleteMany({
        where: { userId: freshUser.id },
      });
      await prisma.users.deleteMany({ where: { id: freshUser.id } });
    }
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

  it('IT-007 (revision) retries a transient OpenAI failure transparently, with no error reaching the client', async () => {
    await seedExercise({ name: 'Retry Transiente' });
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

    const transientError = new OpenAI.APIError(500, {}, 'Internal error', {});
    openAiCreate
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(completion({ explanation: 'Plano após retry.' }));

    const response = await request(app.getHttpServer())
      .post('/workouts/generate')
      .set('Authorization', auth)
      .send({ daysPerWeek: 1 });

    expect(response.status).toBe(201);
    expect(response.body.explanation).toBe('Plano após retry.');
    expect(openAiCreate).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('IT-008 (revision) returns 502/llm_call_failed once the retry budget is exhausted, on the very first conversation turn too', async () => {
    await seedExercise({ name: 'Falha Permanente' });
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
    const transientError = new OpenAI.APIError(500, {}, 'Internal error', {});
    openAiCreate.mockRejectedValue(transientError);

    const response = await request(app.getHttpServer())
      .post('/workouts/generate')
      .set('Authorization', auth)
      .send({ daysPerWeek: 1 });

    expect(response.status).toBe(502);
    expect(response.body.code).toBe('llm_call_failed');
    expect(openAiCreate).toHaveBeenCalledTimes(3);
  }, 10_000);

  it('IT-009 (revision) shows a higher proportion of muscle-focus-matching exercises in the generated plan', async () => {
    const legExercise = await seedExercise({
      name: 'Agachamento Foco',
      muscleGroup: 'Pernas',
    });
    await seedExercise({ name: 'Supino Foco', muscleGroup: 'Peito' });
    await seedExercise({ name: 'Remada Foco', muscleGroup: 'Costas' });
    const auth = await bearer(freeUser);
    await prisma.fitnessProfile.upsert({
      where: { userId: freeUser.id },
      update: {
        goal: 'MUSCLE_GAIN',
        equipment: 'GYM',
        restrictions: [],
        muscleFocus: 'LEGS',
      },
      create: {
        userId: freeUser.id,
        goal: 'MUSCLE_GAIN',
        equipment: 'GYM',
        restrictions: [],
        muscleFocus: 'LEGS',
      },
    });

    openAiCreate.mockResolvedValueOnce(
      completion({ explanation: 'Plano com foco em pernas.' }),
    );
    const response = await request(app.getHttpServer())
      .post('/workouts/generate')
      .set('Authorization', auth)
      .send({ daysPerWeek: 1 });

    expect(response.status).toBe(201);
    const exerciseIds = response.body.days[0].exercises.map(
      (exercise: { exercise: { id: string } }) => exercise.exercise.id,
    );
    expect(exerciseIds).toContain(legExercise.id);
  });

  it('IT-010 (revision) persists a skipped restrictionDetail as null and still generates successfully', async () => {
    await seedExercise({ name: 'Skip Detail' });
    const freshUser = await createUser('skip-detail', {});
    try {
      const auth = await bearer(freshUser);

      const start = await request(app.getHttpServer())
        .post('/workouts/conversation')
        .set('Authorization', auth)
        .send({});
      const conversationId = start.body.conversationId;

      await request(app.getHttpServer())
        .post('/workouts/conversation')
        .set('Authorization', auth)
        .send({ conversationId, answer: '70' });
      await request(app.getHttpServer())
        .post('/workouts/conversation')
        .set('Authorization', auth)
        .send({ conversationId, answer: '170' });

      openAiCreate.mockResolvedValueOnce(
        completion({
          answers: {
            sex: 'MALE',
            goal: 'MUSCLE_GAIN',
            daysPerWeek: 1,
            equipment: 'GYM',
            restrictions: [],
            experienceLevel: 'BEGINNER',
            muscleFocus: 'NONE',
          },
          field: null,
          question: '',
          done: true,
          reprompt: false,
        }),
      );
      const afterSessionDuration = await request(app.getHttpServer())
        .post('/workouts/conversation')
        .set('Authorization', auth)
        .send({ conversationId, answer: '45' });
      expect(afterSessionDuration.body.field).toBe('restrictionDetail');

      openAiCreate.mockResolvedValueOnce(
        completion({ explanation: 'Plano sem detalhe de restrição.' }),
      );
      const final = await request(app.getHttpServer())
        .post('/workouts/conversation')
        .set('Authorization', auth)
        .send({ conversationId, answer: '' });
      expect(final.status).toBe(201);

      const profile = await prisma.fitnessProfile.findUnique({
        where: { userId: freshUser.id },
      });
      expect(profile?.restrictionDetail).toBeNull();
    } finally {
      await prisma.workout.deleteMany({ where: { userId: freshUser.id } });
      await prisma.fitnessProfile.deleteMany({
        where: { userId: freshUser.id },
      });
      await prisma.users.deleteMany({ where: { id: freshUser.id } });
    }
  });

  it('E2E-005 (revision) completes the full expanded conversation — every new field answered, not skipped — and the explanation prompt carries the stated injury detail', async () => {
    const legExercise = await seedExercise({
      name: 'Agachamento E2E',
      muscleGroup: 'Pernas',
    });
    const freshUser = await createUser('full-flow', {});
    try {
      const auth = await bearer(freshUser);

      const start = await request(app.getHttpServer())
        .post('/workouts/conversation')
        .set('Authorization', auth)
        .send({});
      const conversationId = start.body.conversationId;
      expect(start.body.field).toBe('weight');

      await request(app.getHttpServer())
        .post('/workouts/conversation')
        .set('Authorization', auth)
        .send({ conversationId, answer: '82' });
      await request(app.getHttpServer())
        .post('/workouts/conversation')
        .set('Authorization', auth)
        .send({ conversationId, answer: '178' });

      openAiCreate.mockResolvedValueOnce(
        completion({
          answers: {
            sex: 'MALE',
            goal: 'MUSCLE_GAIN',
            daysPerWeek: 1,
            equipment: 'GYM',
            restrictions: ['SHOULDER'],
            experienceLevel: 'INTERMEDIATE',
            muscleFocus: 'LEGS',
          },
          field: null,
          question: '',
          done: true,
          reprompt: false,
        }),
      );
      const afterSessionDuration = await request(app.getHttpServer())
        .post('/workouts/conversation')
        .set('Authorization', auth)
        .send({ conversationId, answer: '60' });
      expect(afterSessionDuration.body.field).toBe('restrictionDetail');
      expect(afterSessionDuration.body.optional).toBe(true);

      openAiCreate.mockResolvedValueOnce(
        completion({
          explanation: 'Plano com foco em pernas, evitando ombro.',
        }),
      );
      const final = await request(app.getHttpServer())
        .post('/workouts/conversation')
        .set('Authorization', auth)
        .send({
          conversationId,
          answer: 'tendinite no ombro direito',
        });
      expect(final.status).toBe(201);
      expect(final.body.explanation).toBe(
        'Plano com foco em pernas, evitando ombro.',
      );
      const exerciseIds = final.body.days[0].exercises.map(
        (exercise: { exercise: { id: string } }) => exercise.exercise.id,
      );
      expect(exerciseIds).toContain(legExercise.id);

      const explainCallArgs = openAiCreate.mock.calls[1][0];
      const explainUserMessage = explainCallArgs.messages.find(
        (message: { role: string }) => message.role === 'user',
      );
      expect(explainUserMessage.content).toContain(
        'tendinite no ombro direito',
      );

      const profile = await prisma.fitnessProfile.findUnique({
        where: { userId: freshUser.id },
      });
      expect(profile?.restrictionDetail).toBe('tendinite no ombro direito');
      expect(profile?.weightKg).toBe(82);
      expect(profile?.heightCm).toBe(178);
      expect(profile?.sessionDurationMin).toBe(60);
      expect(profile?.experienceLevel).toBe('INTERMEDIATE');
      expect(profile?.muscleFocus).toBe('LEGS');
    } finally {
      await prisma.workout.deleteMany({ where: { userId: freshUser.id } });
      await prisma.fitnessProfile.deleteMany({
        where: { userId: freshUser.id },
      });
      await prisma.users.deleteMany({ where: { id: freshUser.id } });
    }
  });
});
