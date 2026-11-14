/**
 * Integration tests for PRD `ai-workout-prescription-b2b` (task_01, backend).
 *
 * Runs the real EducatorAiWorkoutGenerationController/Service, the real
 * manual WorkoutsController/EducatorWorkoutsService (for activation —
 * ADR-004 requires that exact, unmodified endpoint), the real repositories,
 * AuthGuard, PhysicalEducatorGuard, ProfessionalPremiumGuard, and the app's
 * global ValidationPipe against an isolated database. Only the OpenAI client
 * is replaced with a mock (this feature's own rule: no automated test makes
 * a real network call, mirroring `ai-workout-generator.e2e-spec.ts`) —
 * everything else, including the real deterministic RuleEngineService, runs
 * unmocked.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { ProfessionalPremiumGuard } from '@/common/guards/professionalPremium.guard';
import { ConversationStore } from '@/common/conversation/conversationStore';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { EducatorAiWorkoutGenerationController } from '@/educator-students/workouts/aiGeneration/educatorAiWorkoutGeneration.controller';
import { EducatorAiWorkoutGenerationService } from '@/educator-students/workouts/aiGeneration/educatorAiWorkoutGeneration.service';
import { EducatorAiWorkoutLlmService } from '@/educator-students/workouts/aiGeneration/educatorAiWorkoutLlm.service';
import { StudentWorkoutsController } from '@/educator-students/workouts/studentWorkouts.controller';
import { StudentWorkoutsService } from '@/educator-students/workouts/studentWorkouts.service';
import { WorkoutsController } from '@/educator-students/workouts/workouts.controller';
import { EducatorWorkoutsService } from '@/educator-students/workouts/workouts.service';
import { WorkoutNotificationsService } from '@/educator-students/workouts/workoutNotifications.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { FixedSessionsService } from '@/scheduling/fixed-times/fixedSessions.service';
import { OPENAI_CLIENT } from '@/workouts/openaiClient.provider';
import { RuleEngineService } from '@/workouts/ruleEngine.service';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ExerciseContraindication,
  Prisma,
  ProductTier,
  ProductType,
  Users,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(120_000);

const RUN_TAG = `ai-workout-${Date.now()}`;

function completion(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

// One structured turn carrying every answer at once — a valid response
// under the json_schema contract, and the natural integration-test
// shortcut: this suite exercises the generation pipeline (ownership,
// Premium gate, rule engine, persistence, overwrite-check), not the LLM's
// own conversational pacing, which `educatorAiWorkoutLlm.service.spec.ts`
// already covers turn-by-turn.
function doneTurn(overrides: object = {}) {
  return completion({
    answers: {
      goal: 'MUSCLE_GAIN',
      daysPerWeek: 3,
      equipment: 'GYM',
      experienceLevel: 'BEGINNER',
      muscleFocus: 'NONE',
    },
    field: null,
    question: '',
    done: true,
    reprompt: false,
    ...overrides,
  });
}

function explanation(text = 'Plano de treino gerado.') {
  return completion({ explanation: text });
}

describe('Educator AI workout generation integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let educator: Users;
  let otherEducator: Users;
  const openAiCreate = jest.fn();

  const jwtSecret = 'educator-ai-workout-generation-integration-jwt-secret';

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
      controllers: [
        EducatorAiWorkoutGenerationController,
        WorkoutsController,
        StudentWorkoutsController,
      ],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        EducatorWorkoutsRepository,
        ExercisesRepository,
        FitnessProfileRepository,
        RuleEngineService,
        AuthGuard,
        PhysicalEducatorGuard,
        ProfessionalPremiumGuard,
        WorkoutNotificationsService,
        EducatorWorkoutsService,
        EducatorAiWorkoutLlmService,
        ConversationStore,
        EducatorAiWorkoutGenerationService,
        StudentWorkoutsService,
        Clock,
        {
          provide: FixedSessionsService,
          useValue: { todaySessionId: jest.fn().mockResolvedValue(null) },
        },
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

    await seed();
  });

  beforeEach(() => {
    openAiCreate.mockReset();
  });

  afterAll(async () => {
    const ids = [educator, otherEducator].map((u) => u.id);
    await prisma.client.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.exercise.deleteMany({
      where: { name: { startsWith: RUN_TAG } },
    });
    await prisma.fitnessProfile.deleteMany({
      where: { userId: { in: ids } },
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
              name: `${RUN_TAG} educator premium`,
              price: 10,
              type: ProductType.PHYSICAL_EDUCATOR,
              tier: ProductTier.PREMIUM,
            },
            {
              name: `${RUN_TAG} educator free`,
              price: 0,
              type: ProductType.PHYSICAL_EDUCATOR,
              tier: ProductTier.STANDARD,
            },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    const premiumProduct = group.products.find(
      (p) => p.tier === ProductTier.PREMIUM,
    )!;
    const freeProduct = group.products.find(
      (p) => p.tier === ProductTier.STANDARD,
    )!;

    educator = await createUser('educator', { productId: premiumProduct.id });
    otherEducator = await createUser('other-educator-free', {
      productId: freeProduct.id,
    });

    const base = {
      description: 'd',
      primaryMuscles: [],
      secondaryMuscles: [],
      equipment: 'GYM' as const,
      status: 'APPROVED' as const,
    };
    const names = ['Supino', 'Remada', 'Agachamento', 'Leg press', 'Rosca'];
    for (const name of names) {
      await prisma.exercise.create({
        data: {
          ...base,
          name: `${RUN_TAG} ${name}`,
          muscleGroup: 'Peito',
          contraindications: [] as ExerciseContraindication[],
        },
      });
    }
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
      put: (url: string, body: object) =>
        request(server).put(url).set('Authorization', auth).send(body),
    };
  }

  async function registerStudent(by: Users, account?: Users): Promise<string> {
    const caller = await as(by);
    const response = await caller.post(
      '/educator/students',
      account
        ? { email: account.email, linkExistingAccount: true }
        : {
            name: 'Aluno IA Teste',
            email: `${RUN_TAG}-student-${Date.now()}@integration.test`,
            linkExistingAccount: false,
          },
    );
    expect(response.status).toBe(201);
    return response.body.id as string;
  }

  const conversationUrl = (studentId: string) =>
    `/educator/students/${studentId}/workouts/ai-generation/conversation`;

  // Drives the whole conversation in 2 round trips (start + the single
  // structured done turn) plus the explanation call — see `doneTurn`'s
  // comment for why this is a valid, sufficient shortcut for this suite.
  async function generate(
    caller: Awaited<ReturnType<typeof as>>,
    studentId: string,
    body: { workoutId?: string; confirmOverwrite?: boolean } = {},
  ) {
    openAiCreate.mockResolvedValueOnce(doneTurn());
    const start = await caller.post(conversationUrl(studentId), body);
    if (start.status !== 200) return start;

    openAiCreate.mockResolvedValueOnce(explanation());
    return await caller.post(conversationUrl(studentId), {
      conversationId: start.body.conversationId as string,
      answer: '',
    });
  }

  it('IT-001 generates and persists a new DRAFT with sessions/exercises and an explanation', async () => {
    const caller = await as(educator);
    const studentId = await registerStudent(educator);

    const response = await generate(caller, studentId);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('DRAFT');
    expect(response.body.sessions.length).toBeGreaterThan(0);
    expect(
      response.body.sessions.every(
        (session: { exercises: unknown[] }) => session.exercises.length > 0,
      ),
    ).toBe(true);
    expect(response.body.aiExplanation).toBe('Plano de treino gerado.');
  });

  it('IT-001 (negative) rejects a restriction/equipment combination with no eligible exercises, writing nothing', async () => {
    const caller = await as(educator);
    const studentId = await registerStudent(educator);

    openAiCreate.mockResolvedValueOnce(doneTurn({ equipment: 'BODYWEIGHT' }));
    const start = await caller.post(conversationUrl(studentId), {});
    openAiCreate.mockResolvedValueOnce(
      completion({
        answers: {
          goal: 'MUSCLE_GAIN',
          daysPerWeek: 3,
          equipment: 'BODYWEIGHT',
          experienceLevel: 'BEGINNER',
          muscleFocus: 'NONE',
        },
        field: null,
        question: '',
        done: true,
        reprompt: false,
      }),
    );
    const response = await caller.post(conversationUrl(studentId), {
      conversationId: start.body.conversationId as string,
      answer: '',
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('no_eligible_exercises');
  });

  it('IT-001 (degrade) still persists the draft, with aiExplanation null, when the explanation call fails', async () => {
    const caller = await as(educator);
    const studentId = await registerStudent(educator);

    openAiCreate.mockResolvedValueOnce(doneTurn());
    const start = await caller.post(conversationUrl(studentId), {});
    openAiCreate.mockRejectedValue(new Error('simulated upstream failure'));
    const response = await caller.post(conversationUrl(studentId), {
      conversationId: start.body.conversationId as string,
      answer: '',
    });

    expect(response.status).toBe(200);
    expect(response.body.aiExplanation).toBeNull();
  });

  it('IT-002 regenerate overwrites the same draft and never creates a second one', async () => {
    const caller = await as(educator);
    const studentId = await registerStudent(educator);
    const first = await generate(caller, studentId);
    const workoutId = first.body.id as string;

    const second = await generate(caller, studentId, { workoutId });

    expect(second.status).toBe(200);
    expect(second.body.id).toBe(workoutId);
  });

  it('IT-003 requires confirmOverwrite after a manual edit, then succeeds with it', async () => {
    const caller = await as(educator);
    const studentId = await registerStudent(educator);
    const first = await generate(caller, studentId);
    const workoutId = first.body.id as string;

    // A manual save bumps `updatedAt` past `lastGeneratedAt`.
    await caller.post(
      `/educator/students/${studentId}/workouts/${workoutId}`,
      {},
    );

    openAiCreate.mockResolvedValueOnce(doneTurn());
    const blocked = await caller.post(conversationUrl(studentId), {
      workoutId,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('confirm_overwrite_required');

    const confirmed = await generate(caller, studentId, {
      workoutId,
      confirmOverwrite: true,
    });
    expect(confirmed.status).toBe(200);
  });

  it('IT-004 activates an AI-generated draft through the existing, unmodified endpoint', async () => {
    const caller = await as(educator);
    const studentId = await registerStudent(educator);
    const generated = await generate(caller, studentId);
    const workoutId = generated.body.id as string;

    const activation = await caller.post(
      `/educator/students/${studentId}/workouts/${workoutId}/activate`,
    );

    expect(activation.status).toBe(200);
    expect(activation.body.status).toBe('ACTIVE');
  });

  it('IT-006 rejects a non-Premium educator before any conversation starts', async () => {
    const caller = await as(otherEducator);
    const studentId = await registerStudent(otherEducator);

    const response = await caller.post(conversationUrl(studentId), {});

    expect(response.status).toBe(403);
    expect(openAiCreate).not.toHaveBeenCalled();
  });

  it('IT-007 rejects a student not owned by the calling educator', async () => {
    const studentOfA = await registerStudent(educator);
    const callerForB = await as(otherEducator);

    const response = await callerForB.post(conversationUrl(studentOfA), {});

    expect(response.status).toBe(404);
  });

  it('IT-005 rejects activation of an AI-generated draft after a session is manually emptied', async () => {
    const caller = await as(educator);
    const studentId = await registerStudent(educator);
    const generated = await generate(caller, studentId);
    const workoutId = generated.body.id as string;

    type GeneratedExercise = {
      id: string;
      source: string;
      exerciseId: string | null;
      sets: number;
      reps: string;
      load: string | null;
      videoUrl: string | null;
    };
    const sessions = generated.body.sessions as Array<{
      id: string;
      name: string;
      exercises: GeneratedExercise[];
    }>;
    const save = await caller.put(
      `/educator/students/${studentId}/workouts/${workoutId}`,
      {
        title: generated.body.title,
        weeklyFrequency: generated.body.weeklyFrequency,
        sessions: sessions.map((session, index) => ({
          id: session.id,
          name: session.name,
          exercises:
            index === 0
              ? []
              : session.exercises.map((exercise) => ({
                  id: exercise.id,
                  source: exercise.source,
                  exerciseId: exercise.exerciseId ?? undefined,
                  sets: exercise.sets,
                  reps: exercise.reps,
                  load: exercise.load ?? undefined,
                  videoUrl: exercise.videoUrl ?? undefined,
                })),
        })),
      },
    );
    expect(save.status).toBe(200);

    const activation = await caller.post(
      `/educator/students/${studentId}/workouts/${workoutId}/activate`,
    );

    expect(activation.status).toBe(422);
    expect(activation.body.code).toBe('workout_not_activatable');
  });

  it('IT-008 exposes aiExplanation to the educator but never to the student-facing view', async () => {
    const caller = await as(educator);
    const studentAccount = await createUser('ai-student-account', {});
    const studentId = await registerStudent(educator, studentAccount);
    const generated = await generate(caller, studentId);
    const workoutId = generated.body.id as string;

    const educatorView = await caller.get(
      `/educator/students/${studentId}/workouts/${workoutId}`,
    );
    expect(educatorView.body.aiExplanation).toBe('Plano de treino gerado.');

    await caller.post(
      `/educator/students/${studentId}/workouts/${workoutId}/activate`,
    );

    const studentCaller = await as(studentAccount);
    const studentView = await studentCaller.get('/me/educator-workouts');

    expect(studentView.status).toBe(200);
    expect(JSON.stringify(studentView.body)).not.toContain('aiExplanation');
    expect(JSON.stringify(studentView.body)).not.toContain(
      'Plano de treino gerado.',
    );

    await prisma.users.delete({ where: { id: studentAccount.id } });
  });
});
