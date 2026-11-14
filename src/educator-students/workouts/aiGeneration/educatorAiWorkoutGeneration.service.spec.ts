import { Test, TestingModule } from '@nestjs/testing';
import { Client } from '@prisma/client';
import { ConversationStore } from '@/common/conversation/conversationStore';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { RuleEngineService } from '@/workouts/ruleEngine.service';
import { EducatorAiWorkoutGenerationService } from './educatorAiWorkoutGeneration.service';
import { EducatorAiWorkoutLlmService } from './educatorAiWorkoutLlm.service';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Aluno',
    email: 'aluno@example.com',
    phone: null,
    birthDate: new Date('2000-01-01'),
    userId: null,
    professionalId: 'educator-1',
    academiaId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Client;
}

const DONE_TURN = {
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
};

const USABLE_PLAN = {
  scaled: false,
  days: [
    {
      dayOfWeek: 1,
      exercises: [{ exerciseId: 'ex-1', sets: 3, reps: 10, order: 1 }],
    },
    {
      dayOfWeek: 2,
      exercises: [{ exerciseId: 'ex-1', sets: 3, reps: 10, order: 1 }],
    },
    {
      dayOfWeek: 3,
      exercises: [{ exerciseId: 'ex-1', sets: 3, reps: 10, order: 1 }],
    },
  ],
};

const UNUSABLE_PLAN = {
  scaled: true,
  days: [
    { dayOfWeek: 1, exercises: [] },
    { dayOfWeek: 2, exercises: [] },
    { dayOfWeek: 3, exercises: [] },
  ],
};

describe('EducatorAiWorkoutGenerationService', () => {
  const clientsFindOwnedById = jest.fn();
  const workoutsFindOwnedTree = jest.fn();
  const workoutsCreateGeneratedDraft = jest.fn();
  const workoutsApplyGeneratedTree = jest.fn();
  const exercisesFindApprovedByIds = jest.fn();
  const profilesFindByUserId = jest.fn();
  const ruleEngineSelect = jest.fn();
  const llmNextQuestion = jest.fn();
  const llmExplain = jest.fn();

  let service: EducatorAiWorkoutGenerationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EducatorAiWorkoutGenerationService,
        ConversationStore,
        {
          provide: ClientsRepository,
          useValue: { findOwnedById: clientsFindOwnedById },
        },
        {
          provide: EducatorWorkoutsRepository,
          useValue: {
            findOwnedTree: workoutsFindOwnedTree,
            createGeneratedDraft: workoutsCreateGeneratedDraft,
            applyGeneratedTree: workoutsApplyGeneratedTree,
          },
        },
        {
          provide: ExercisesRepository,
          useValue: { findApprovedByIds: exercisesFindApprovedByIds },
        },
        {
          provide: FitnessProfileRepository,
          useValue: { findByUserId: profilesFindByUserId },
        },
        { provide: RuleEngineService, useValue: { select: ruleEngineSelect } },
        {
          provide: EducatorAiWorkoutLlmService,
          useValue: { nextQuestion: llmNextQuestion, explain: llmExplain },
        },
      ],
    }).compile();
    service = module.get(EducatorAiWorkoutGenerationService);

    clientsFindOwnedById.mockResolvedValue(client());
    exercisesFindApprovedByIds.mockResolvedValue([
      { id: 'ex-1', name: 'Supino', muscleGroup: 'Peito', equipment: 'GYM' },
    ]);
    ruleEngineSelect.mockResolvedValue(USABLE_PLAN);
    llmExplain.mockResolvedValue('explicação');
    workoutsCreateGeneratedDraft.mockResolvedValue({
      id: 'created-1',
      title: 'Treino gerado por IA',
      status: 'DRAFT',
      weeklyFrequency: 3,
      updatedAt: new Date(),
      sessions: [],
    });
    workoutsApplyGeneratedTree.mockResolvedValue({
      id: 'target-1',
      title: 'Treino do João',
      status: 'DRAFT',
      weeklyFrequency: 3,
      updatedAt: new Date(),
      sessions: [],
    });
  });

  // UT-009
  it('starts a new-draft conversation with targetWorkoutId null when no workoutId is given', async () => {
    llmNextQuestion.mockResolvedValue({
      answers: {},
      field: 'goal',
      question: 'Qual o objetivo?',
      done: false,
      reprompt: false,
    });

    await service.startConversation(
      'educator-1',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(workoutsFindOwnedTree).not.toHaveBeenCalled();
    expect(workoutsCreateGeneratedDraft).not.toHaveBeenCalled();
  });

  // UT-010
  it('allows a regenerate without confirmOverwrite when the draft was not edited since its last generation', async () => {
    const now = new Date('2026-11-13T12:00:00Z');
    workoutsFindOwnedTree.mockResolvedValue({
      id: 'target-1',
      title: 'Treino existente',
      updatedAt: new Date(now.getTime() - 60_000),
      lastGeneratedAt: now,
    });
    llmNextQuestion.mockResolvedValue({
      answers: {},
      field: 'goal',
      question: 'Qual o objetivo?',
      done: false,
      reprompt: false,
    });

    await expect(
      service.startConversation(
        'educator-1',
        '11111111-1111-4111-8111-111111111111',
        'target-1',
        false,
      ),
    ).resolves.toBeDefined();
  });

  // UT-011
  it('throws confirm_overwrite_required when the target draft was edited after its last generation', async () => {
    const now = new Date('2026-11-13T12:00:00Z');
    workoutsFindOwnedTree.mockResolvedValue({
      id: 'target-1',
      title: 'Treino existente',
      updatedAt: now,
      lastGeneratedAt: new Date(now.getTime() - 60_000),
    });

    await expect(
      service.startConversation(
        'educator-1',
        '11111111-1111-4111-8111-111111111111',
        'target-1',
        false,
      ),
    ).rejects.toMatchObject({ code: 'confirm_overwrite_required' });
  });

  // UT-012
  it('proceeds despite prior edits when confirmOverwrite is true', async () => {
    const now = new Date('2026-11-13T12:00:00Z');
    workoutsFindOwnedTree.mockResolvedValue({
      id: 'target-1',
      title: 'Treino existente',
      updatedAt: now,
      lastGeneratedAt: new Date(now.getTime() - 60_000),
    });
    llmNextQuestion.mockResolvedValue({
      answers: {},
      field: 'goal',
      question: 'Qual o objetivo?',
      done: false,
      reprompt: false,
    });

    await expect(
      service.startConversation(
        'educator-1',
        '11111111-1111-4111-8111-111111111111',
        'target-1',
        true,
      ),
    ).resolves.toBeDefined();
  });

  // UT-013
  it('creates a new EducatorWorkout draft on completion when targetWorkoutId is null', async () => {
    llmNextQuestion.mockResolvedValue(DONE_TURN);

    await service.startConversation(
      'educator-1',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(ruleEngineSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: 'MUSCLE_GAIN',
        daysPerWeek: 3,
        equipment: 'GYM',
      }),
    );
    expect(llmExplain).toHaveBeenCalled();
    expect(workoutsCreateGeneratedDraft).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ title: 'Treino gerado por IA' }),
      'explicação',
      expect.any(Date),
    );
  });

  // UT-014
  it('overwrites the existing draft (same title preserved) on completion when targetWorkoutId is set', async () => {
    workoutsFindOwnedTree.mockResolvedValue({
      id: 'target-1',
      title: 'Treino do João',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      lastGeneratedAt: new Date('2026-01-01T00:00:00Z'),
    });
    llmNextQuestion.mockResolvedValue(DONE_TURN);

    await service.startConversation(
      'educator-1',
      '11111111-1111-4111-8111-111111111111',
      'target-1',
      false,
    );

    expect(workoutsApplyGeneratedTree).toHaveBeenCalledWith(
      'target-1',
      expect.objectContaining({ title: 'Treino do João' }),
      'explicação',
      expect.any(Date),
    );
    expect(workoutsCreateGeneratedDraft).not.toHaveBeenCalled();
  });

  // UT-015
  it('throws no_eligible_exercises and writes nothing when the rule engine plan is unusable', async () => {
    ruleEngineSelect.mockResolvedValue(UNUSABLE_PLAN);
    llmNextQuestion.mockResolvedValue(DONE_TURN);

    await expect(
      service.startConversation(
        'educator-1',
        '11111111-1111-4111-8111-111111111111',
      ),
    ).rejects.toMatchObject({ code: 'no_eligible_exercises' });
    expect(workoutsCreateGeneratedDraft).not.toHaveBeenCalled();
  });

  // UT-016
  it('treats a student with no FitnessProfile as having no restrictions', async () => {
    clientsFindOwnedById.mockResolvedValue(client({ userId: 'user-1' }));
    profilesFindByUserId.mockResolvedValue(null);
    llmNextQuestion.mockResolvedValue(DONE_TURN);

    await service.startConversation(
      'educator-1',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(ruleEngineSelect).toHaveBeenCalledWith(
      expect.objectContaining({ restrictions: [] }),
    );
  });

  // UT-017
  it('still creates the draft, with aiExplanation null, when explain() degrades to null', async () => {
    llmExplain.mockResolvedValue(null);
    llmNextQuestion.mockResolvedValue(DONE_TURN);

    await service.startConversation(
      'educator-1',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(workoutsCreateGeneratedDraft).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.anything(),
      null,
      expect.any(Date),
    );
  });

  // UT-018
  it('rejects generation for a student not owned by the calling educator', async () => {
    clientsFindOwnedById.mockResolvedValue(null);

    await expect(
      service.startConversation(
        'educator-1',
        '22222222-2222-4222-8222-222222222222',
      ),
    ).rejects.toMatchObject({ code: 'student_not_found' });
  });

  // UT-019
  it('does not touch an unrelated active workout when creating a new draft', async () => {
    llmNextQuestion.mockResolvedValue(DONE_TURN);

    await service.startConversation(
      'educator-1',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(workoutsApplyGeneratedTree).not.toHaveBeenCalled();
  });

  // UT-020
  it('reprompts for daysPerWeek when the answer is out of the 1-7 range', async () => {
    llmNextQuestion.mockResolvedValue({
      answers: { daysPerWeek: 10 },
      field: null,
      question: '',
      done: false,
      reprompt: false,
    });

    const result = await service.startConversation(
      'educator-1',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(result).toMatchObject({ field: 'daysPerWeek', reprompt: true });
    expect(workoutsCreateGeneratedDraft).not.toHaveBeenCalled();
  });

  describe('answer', () => {
    it('throws conversation_not_found for an unknown conversationId', async () => {
      await expect(
        service.answer('educator-1', 'missing-conversation', 'resposta'),
      ).rejects.toMatchObject({ code: 'conversation_not_found' });
    });
  });
});
