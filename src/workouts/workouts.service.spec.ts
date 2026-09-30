import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { WorkoutsRepository } from '@/repositories/workouts/workouts.repository';
import { AppError } from '@/utils/app.erro';
import { Test, TestingModule } from '@nestjs/testing';
import { Exercise, FitnessProfile, Users } from '@prisma/client';
import { ConversationStore } from './conversationStore';
import { LlmExplanationService } from './llmExplanation.service';
import { ConversationTurn } from './llmExplanation.types';
import { RuleEngineService } from './ruleEngine.service';
import { GeneratedPlan } from './ruleEngine.types';
import { WorkoutsService } from './workouts.service';

function makeUser(overrides: Partial<Users> = {}): Users {
  const timestamp = new Date('2026-09-30T09:00:00.000Z');
  return {
    id: 'user-1',
    name: 'Usuária',
    email: 'user@example.com',
    password: 'hash',
    avatar: null,
    active: true,
    phone: null,
    birthDate: new Date('1990-01-01'),
    productId: null,
    termsAcceptedAt: timestamp,
    healthDataConsentAt: timestamp,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    subscriptionCancelAt: null,
    subscriptionCurrentPeriodEnd: null,
    isBackoffice: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<FitnessProfile> = {}): FitnessProfile {
  const timestamp = new Date('2026-09-30T09:00:00.000Z');
  return {
    id: 'profile-1',
    userId: 'user-1',
    sex: null,
    restrictions: [],
    equipment: null,
    goal: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  const timestamp = new Date('2026-09-30T09:00:00.000Z');
  return {
    id: 'exercise-1',
    name: 'Agachamento',
    description: 'Descrição',
    muscleGroup: 'Pernas',
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: 'GYM',
    contraindications: [],
    difficulty: null,
    imageUrl: null,
    videoUrl: null,
    status: 'APPROVED',
    sourceAttribution: null,
    sourceLicense: null,
    submittedById: null,
    reviewedById: null,
    rejectionReason: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

const USABLE_PLAN: GeneratedPlan = {
  scaled: false,
  days: [
    {
      dayOfWeek: 1,
      exercises: [{ exerciseId: 'exercise-1', sets: 3, reps: 10, order: 1 }],
    },
  ],
};

function makeTurn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    answers: {},
    field: 'sex',
    question: 'Qual é o seu sexo?',
    done: false,
    reprompt: false,
    ...overrides,
  };
}

describe('WorkoutsService', () => {
  const fitnessProfileFindByUserId = jest.fn();
  const fitnessProfileUpsert = jest.fn();
  const userFindUnique = jest.fn();
  const userFindByIdWithProduct = jest.fn();
  const userUpdateUserProfile = jest.fn();
  const exerciseFindById = jest.fn();
  const ruleEngineSelect = jest.fn();
  const llmNextQuestion = jest.fn();
  const llmExplain = jest.fn();
  const workoutsFindCurrentByUserId = jest.fn();
  const workoutsExistsForUser = jest.fn();
  const workoutsReplace = jest.fn();
  const workoutsFindExerciseContext = jest.fn();
  const workoutsUpdateExerciseRow = jest.fn();
  const workoutsDeleteExerciseRow = jest.fn();

  let service: WorkoutsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutsService,
        ConversationStore,
        {
          provide: FitnessProfileRepository,
          useValue: {
            findByUserId: fitnessProfileFindByUserId,
            upsert: fitnessProfileUpsert,
          },
        },
        {
          provide: UserRepository,
          useValue: {
            findUnique: userFindUnique,
            findByIdWithProduct: userFindByIdWithProduct,
            updateUserProfile: userUpdateUserProfile,
          },
        },
        {
          provide: ExercisesRepository,
          useValue: { findById: exerciseFindById },
        },
        { provide: RuleEngineService, useValue: { select: ruleEngineSelect } },
        {
          provide: LlmExplanationService,
          useValue: { nextQuestion: llmNextQuestion, explain: llmExplain },
        },
        {
          provide: WorkoutsRepository,
          useValue: {
            findCurrentByUserId: workoutsFindCurrentByUserId,
            existsForUser: workoutsExistsForUser,
            replace: workoutsReplace,
            findExerciseContext: workoutsFindExerciseContext,
            updateExerciseRow: workoutsUpdateExerciseRow,
            deleteExerciseRow: workoutsDeleteExerciseRow,
          },
        },
      ],
    }).compile();
    service = module.get(WorkoutsService);

    fitnessProfileFindByUserId.mockResolvedValue(null);
    userFindUnique.mockResolvedValue(makeUser());
    llmNextQuestion.mockResolvedValue(makeTurn());
  });

  describe('startConversation', () => {
    it('UT-001 gets a first question with no gate/subscription check for any user', async () => {
      const turn = await service.startConversation('user-1');

      expect(turn.field).toBe('sex');
      expect(workoutsExistsForUser).not.toHaveBeenCalled();
      expect(userFindByIdWithProduct).not.toHaveBeenCalled();
    });

    it('UT-002 asks age when birthDate is null, and does not call the LLM yet', async () => {
      userFindUnique.mockResolvedValue(makeUser({ birthDate: null }));

      const turn = await service.startConversation('user-1');

      expect(turn.field).toBe('age');
      expect(llmNextQuestion).not.toHaveBeenCalled();
    });

    it('UT-002 does not ask age when birthDate is already set', async () => {
      userFindUnique.mockResolvedValue(
        makeUser({ birthDate: new Date('1990-01-01') }),
      );

      const turn = await service.startConversation('user-1');

      expect(turn.field).not.toBe('age');
      expect(llmNextQuestion).toHaveBeenCalled();
    });

    it('UT-024 pre-fills sex/equipment/restrictions but never goal, from a prior FitnessProfile', async () => {
      fitnessProfileFindByUserId.mockResolvedValue(
        makeProfile({
          sex: 'MALE',
          equipment: 'GYM',
          restrictions: ['KNEE'],
          goal: 'MUSCLE_GAIN',
        }),
      );
      llmNextQuestion.mockResolvedValue(makeTurn({ field: 'goal' }));

      const turn = await service.startConversation('user-1');

      expect(llmNextQuestion).toHaveBeenCalledWith({
        answers: { sex: 'MALE', equipment: 'GYM', restrictions: ['KNEE'] },
      });
      expect(turn.field).toBe('goal');
    });
  });

  describe('answer', () => {
    it('UT-003 never writes a Workout or FitnessProfile for an incomplete conversation', async () => {
      const start = await service.startConversation('user-1');
      llmNextQuestion.mockResolvedValue(
        makeTurn({ answers: { sex: 'MALE' }, field: 'goal' }),
      );

      await service.answer('user-1', start.conversationId, 'masculino');

      expect(workoutsReplace).not.toHaveBeenCalled();
      expect(fitnessProfileUpsert).not.toHaveBeenCalled();
    });

    it('UT-004 accumulates each answered field into the running conversation state', async () => {
      const start = await service.startConversation('user-1');
      llmNextQuestion.mockResolvedValue(
        makeTurn({ answers: { sex: 'MALE' }, field: 'goal' }),
      );
      await service.answer('user-1', start.conversationId, 'masculino');

      llmNextQuestion.mockResolvedValue(
        makeTurn({
          answers: { sex: 'MALE', goal: 'MUSCLE_GAIN' },
          field: 'daysPerWeek',
        }),
      );
      await service.answer('user-1', start.conversationId, 'ganho de massa');

      expect(llmNextQuestion).toHaveBeenLastCalledWith({
        answers: { sex: 'MALE' },
        pendingField: 'goal',
        pendingRawAnswer: 'ganho de massa',
      });
    });

    it('UT-005 reprompts instead of advancing on an unintelligible answer', async () => {
      const start = await service.startConversation('user-1');
      llmNextQuestion.mockResolvedValue(
        makeTurn({
          answers: {},
          field: 'daysPerWeek',
          question: 'Quantos dias por semana?',
          reprompt: true,
        }),
      );

      const turn = await service.answer(
        'user-1',
        start.conversationId,
        'xyz123',
      );

      expect('reprompt' in turn && turn.reprompt).toBe(true);
      expect((turn as { field: string }).field).toBe('daysPerWeek');
    });

    it('UT-006 accepts "nenhuma" as an empty restrictions list, not incomplete', async () => {
      const start = await service.startConversation('user-1');
      llmNextQuestion.mockResolvedValue(
        makeTurn({
          answers: { restrictions: [] },
          field: 'daysPerWeek',
          reprompt: false,
        }),
      );

      const turn = await service.answer(
        'user-1',
        start.conversationId,
        'nenhuma',
      );

      expect('reprompt' in turn && turn.reprompt).toBe(false);
    });

    it('UT-007 captures multiple restrictions from one free-text answer', async () => {
      const start = await service.startConversation('user-1');
      llmNextQuestion.mockResolvedValue(
        makeTurn({
          answers: { restrictions: ['SHOULDER', 'KNEE'] },
          field: 'daysPerWeek',
        }),
      );
      await service.answer('user-1', start.conversationId, 'ombro e joelho');

      llmNextQuestion.mockResolvedValue(makeTurn({ field: 'equipment' }));
      await service.answer('user-1', start.conversationId, '3');

      expect(llmNextQuestion).toHaveBeenLastCalledWith(
        expect.objectContaining({
          answers: expect.objectContaining({
            restrictions: ['SHOULDER', 'KNEE'],
          }),
        }),
      );
    });

    it('UT-025 lets a pre-filled restriction be overwritten before the conversation completes', async () => {
      fitnessProfileFindByUserId.mockResolvedValue(
        makeProfile({ restrictions: ['KNEE'] }),
      );
      llmNextQuestion.mockResolvedValue(
        makeTurn({
          answers: { restrictions: ['KNEE'] },
          field: 'restrictions',
        }),
      );
      const start = await service.startConversation('user-1');

      llmNextQuestion.mockResolvedValue(
        makeTurn({
          answers: { restrictions: ['SHOULDER'] },
          field: 'daysPerWeek',
        }),
      );
      await service.answer('user-1', start.conversationId, 'só ombro agora');

      llmNextQuestion.mockResolvedValue(makeTurn({ field: 'equipment' }));
      await service.answer('user-1', start.conversationId, '3');

      expect(llmNextQuestion).toHaveBeenLastCalledWith(
        expect.objectContaining({
          answers: expect.objectContaining({ restrictions: ['SHOULDER'] }),
        }),
      );
    });

    it('UT-026 stores an empty restrictions list when consent was never given', async () => {
      userFindUnique.mockResolvedValue(makeUser({ healthDataConsentAt: null }));
      const start = await service.startConversation('user-1');
      llmNextQuestion.mockResolvedValue(
        makeTurn({
          answers: {
            sex: 'MALE',
            goal: 'MUSCLE_GAIN',
            daysPerWeek: 3,
            equipment: 'GYM',
            restrictions: ['SHOULDER'],
          },
          field: null,
          done: true,
        }),
      );
      fitnessProfileFindByUserId.mockResolvedValue(
        makeProfile({
          equipment: 'GYM',
          goal: 'MUSCLE_GAIN',
          restrictions: [],
        }),
      );
      userFindByIdWithProduct.mockResolvedValue(
        makeUser({ healthDataConsentAt: null, product: { price: 0 } } as never),
      );
      workoutsExistsForUser.mockResolvedValue(false);
      ruleEngineSelect.mockResolvedValue(USABLE_PLAN);
      llmExplain.mockResolvedValue('Explicação.');
      workoutsReplace.mockResolvedValue({ id: 'workout-1' });

      await service.answer('user-1', start.conversationId, 'ombro');

      expect(fitnessProfileUpsert).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ restrictions: [] }),
      );
    });

    it('respects consent and stores the restriction list when consent was given', async () => {
      const start = await service.startConversation('user-1');
      llmNextQuestion.mockResolvedValue(
        makeTurn({
          answers: {
            sex: 'MALE',
            goal: 'MUSCLE_GAIN',
            daysPerWeek: 3,
            equipment: 'GYM',
            restrictions: ['SHOULDER'],
          },
          field: null,
          done: true,
        }),
      );
      fitnessProfileFindByUserId.mockResolvedValue(
        makeProfile({
          equipment: 'GYM',
          goal: 'MUSCLE_GAIN',
          restrictions: ['SHOULDER'],
        }),
      );
      userFindByIdWithProduct.mockResolvedValue(
        makeUser({ product: { price: 0 } } as never),
      );
      workoutsExistsForUser.mockResolvedValue(false);
      ruleEngineSelect.mockResolvedValue(USABLE_PLAN);
      llmExplain.mockResolvedValue('Explicação.');
      workoutsReplace.mockResolvedValue({ id: 'workout-1' });

      await service.answer('user-1', start.conversationId, 'ombro');

      expect(fitnessProfileUpsert).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ restrictions: ['SHOULDER'] }),
      );
    });
  });

  describe('regenerate', () => {
    beforeEach(() => {
      fitnessProfileFindByUserId.mockResolvedValue(
        makeProfile({
          goal: 'MUSCLE_GAIN',
          equipment: 'GYM',
          restrictions: [],
        }),
      );
      ruleEngineSelect.mockResolvedValue(USABLE_PLAN);
      llmExplain.mockResolvedValue('Explicação gerada.');
      workoutsReplace.mockResolvedValue({ id: 'workout-1' });
    });

    it('UT-014 succeeds and replaces the prior workout for an active Premium user', async () => {
      userFindByIdWithProduct.mockResolvedValue(
        makeUser({
          subscriptionStatus: 'active',
          product: { price: 49 },
        } as never),
      );
      workoutsExistsForUser.mockResolvedValue(true);

      const result = await service.regenerate('user-1', 3);

      expect(result).toEqual({ id: 'workout-1' });
      expect(workoutsReplace).toHaveBeenCalled();
    });

    it('UT-015 treats a past_due subscription as active, following the existing definition', async () => {
      userFindByIdWithProduct.mockResolvedValue(
        makeUser({
          subscriptionStatus: 'past_due',
          product: { price: 49 },
        } as never),
      );
      workoutsExistsForUser.mockResolvedValue(true);

      await expect(service.regenerate('user-1', 3)).resolves.toEqual({
        id: 'workout-1',
      });
    });

    it('UT-016 rejects a Free-tier regeneration with 402 before any LLM call', async () => {
      userFindByIdWithProduct.mockResolvedValue(
        makeUser({ subscriptionStatus: null, product: { price: 0 } } as never),
      );
      workoutsExistsForUser.mockResolvedValue(true);

      await expect(service.regenerate('user-1', 3)).rejects.toMatchObject({
        message: 'Regeneração requer o plano Premium.',
      });
      expect(llmExplain).not.toHaveBeenCalled();
      expect(ruleEngineSelect).not.toHaveBeenCalled();
    });

    it('UT-017 never gates the first generation, regardless of plan tier', async () => {
      userFindByIdWithProduct.mockResolvedValue(
        makeUser({ subscriptionStatus: null, product: { price: 0 } } as never),
      );
      workoutsExistsForUser.mockResolvedValue(false);

      await expect(service.regenerate('user-1', 3)).resolves.toEqual({
        id: 'workout-1',
      });
    });

    it('throws 422 when the generated plan is not usable', async () => {
      userFindByIdWithProduct.mockResolvedValue(
        makeUser({ subscriptionStatus: null, product: { price: 0 } } as never),
      );
      workoutsExistsForUser.mockResolvedValue(false);
      ruleEngineSelect.mockResolvedValue({
        scaled: true,
        days: [{ dayOfWeek: 1, exercises: [] }],
      });

      await expect(service.regenerate('user-1', 3)).rejects.toMatchObject({
        message: 'Não há exercícios suficientes para os critérios informados.',
      });
    });
  });

  describe('getCurrent', () => {
    it('UT-018 returns the full nested workout structure', async () => {
      const workout = {
        id: 'workout-1',
        days: [{ id: 'day-1', exercises: [] }],
      };
      workoutsFindCurrentByUserId.mockResolvedValue(workout);

      await expect(service.getCurrent('user-1')).resolves.toBe(workout);
    });

    it('UT-019 does not throw when a WorkoutExercise references a since-removed exercise', async () => {
      const workout = {
        id: 'workout-1',
        days: [
          {
            id: 'day-1',
            exercises: [{ id: 'we-1', exerciseId: null, exercise: null }],
          },
        ],
      };
      workoutsFindCurrentByUserId.mockResolvedValue(workout);

      await expect(service.getCurrent('user-1')).resolves.toEqual(workout);
    });
  });

  describe('updateExercise', () => {
    beforeEach(() => {
      workoutsFindExerciseContext.mockResolvedValue({
        id: 'we-1',
        workoutDay: { workout: { userId: 'user-1' }, _count: { exercises: 2 } },
      });
      workoutsFindCurrentByUserId.mockResolvedValue({ id: 'workout-1' });
      fitnessProfileFindByUserId.mockResolvedValue(
        makeProfile({ restrictions: [] }),
      );
      exerciseFindById.mockResolvedValue(makeExercise());
    });

    it('UT-020 swaps the exercise and persists immediately', async () => {
      await service.updateExercise('user-1', 'we-1', {
        exerciseId: 'exercise-2',
      });

      expect(workoutsUpdateExerciseRow).toHaveBeenCalledWith('we-1', {
        exerciseId: 'exercise-2',
      });
    });

    it('UT-021 rejects a replacement contraindicated for the user restrictions', async () => {
      fitnessProfileFindByUserId.mockResolvedValue(
        makeProfile({ restrictions: ['SHOULDER'] }),
      );
      exerciseFindById.mockResolvedValue(
        makeExercise({ contraindications: ['SHOULDER'] }),
      );

      await expect(
        service.updateExercise('user-1', 'we-1', { exerciseId: 'exercise-2' }),
      ).rejects.toBeInstanceOf(AppError);
      expect(workoutsUpdateExerciseRow).not.toHaveBeenCalled();
    });

    it('UT-022 rejects removing the last exercise from a WorkoutDay', async () => {
      workoutsFindExerciseContext.mockResolvedValue({
        id: 'we-1',
        workoutDay: { workout: { userId: 'user-1' }, _count: { exercises: 1 } },
      });

      await expect(
        service.updateExercise('user-1', 'we-1', { remove: true }),
      ).rejects.toBeInstanceOf(AppError);
      expect(workoutsDeleteExerciseRow).not.toHaveBeenCalled();
    });

    it('UT-023 rejects a non-positive sets value', async () => {
      await expect(
        service.updateExercise('user-1', 'we-1', { sets: -1 }),
      ).rejects.toBeInstanceOf(AppError);
    });

    it('UT-023 rejects a zero reps value', async () => {
      await expect(
        service.updateExercise('user-1', 'we-1', { reps: 0 }),
      ).rejects.toBeInstanceOf(AppError);
    });
  });
});
