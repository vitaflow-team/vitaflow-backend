import { ConversationStore } from '@/common/conversation/conversationStore';
import { CodedError } from '@/common/errors/codedError';
import { ClientNutritionProfileRepository } from '@/repositories/meal-plans/clientNutritionProfile.repository';
import { MealPlansRepository } from '@/repositories/meal-plans/mealPlans.repository';
import { AppError } from '@/utils/app.erro';
import { Test, TestingModule } from '@nestjs/testing';
import { ClientNutritionProfile, Weekday } from '@prisma/client';
import { MealPlanConversationTurnResult } from './mealPlanConversation.types';
import { MealPlanGenerationService } from './mealPlanGeneration.service';
import { MealPlanLlmService } from './mealPlanLlm.service';

function makeProfile(
  overrides: Partial<ClientNutritionProfile> = {},
): ClientNutritionProfile {
  return {
    clientId: 'client-1',
    goal: 'Perda de peso',
    restrictions: 'nenhuma',
    targetCalories: 1800,
    mealsPerDay: 3,
    updatedAt: new Date('2026-09-30T09:00:00.000Z'),
    ...overrides,
  };
}

function makeGeneratedDays() {
  return (Object.values(Weekday) as Weekday[]).map((weekday) => ({
    weekday,
    meals: [{ label: 'Almoço', text: 'Arroz, feijão e frango' }],
  }));
}

describe('MealPlanGenerationService', () => {
  const profilesFindByClientId = jest.fn();
  const profilesUpsert = jest.fn();
  const llmNextQuestion = jest.fn();
  const llmGeneratePlan = jest.fn();
  const mealPlansFindDraftByClient = jest.fn();
  const mealPlansReplaceAllDaysMeals = jest.fn();

  let service: MealPlanGenerationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MealPlanGenerationService,
        ConversationStore,
        {
          provide: ClientNutritionProfileRepository,
          useValue: {
            findByClientId: profilesFindByClientId,
            upsert: profilesUpsert,
          },
        },
        {
          provide: MealPlanLlmService,
          useValue: {
            nextQuestion: llmNextQuestion,
            generatePlan: llmGeneratePlan,
          },
        },
        {
          provide: MealPlansRepository,
          useValue: {
            findDraftByClient: mealPlansFindDraftByClient,
            replaceAllDaysMeals: mealPlansReplaceAllDaysMeals,
          },
        },
      ],
    }).compile();
    service = module.get(MealPlanGenerationService);

    profilesFindByClientId.mockResolvedValue(null);
    // Default: the LLM phase completes in one mocked turn, landing the
    // conversation on the first deterministic question.
    llmNextQuestion.mockResolvedValue({
      answers: { goal: 'Perda de peso', restrictions: 'nenhuma' },
      field: null,
      question: '',
      done: true,
      reprompt: false,
    });
    mealPlansFindDraftByClient.mockResolvedValue({ id: 'plan-1' });
    mealPlansReplaceAllDaysMeals.mockResolvedValue({ id: 'plan-1', days: [] });
    llmGeneratePlan.mockResolvedValue(makeGeneratedDays());
  });

  async function advanceToTargetCalories(
    clientId = 'client-1',
    professionalId = 'prof-1',
  ): Promise<MealPlanConversationTurnResult> {
    return (await service.startConversation(
      clientId,
      professionalId,
    )) as MealPlanConversationTurnResult;
  }

  async function completeConversation(
    professionalId: string,
    clientId: string,
    targetCaloriesAnswer: string,
    mealsPerDayAnswer: string,
  ) {
    const turn1 = await advanceToTargetCalories(clientId, professionalId);
    const turn2 = (await service.answer(
      professionalId,
      turn1.conversationId,
      targetCaloriesAnswer,
    )) as MealPlanConversationTurnResult;
    return await service.answer(
      professionalId,
      turn2.conversationId,
      mealsPerDayAnswer,
    );
  }

  describe('startConversation', () => {
    it('UT-011 proceeds straight through the intake with no confirm-overwrite concept at this layer', async () => {
      const turn = await advanceToTargetCalories();
      expect(turn.field).toBe('targetCalories');
      expect(turn.optional).toBe(true);
    });

    it('UT-020 no existing profile: every field starts empty, no prior-value hint shown', async () => {
      profilesFindByClientId.mockResolvedValue(null);
      const turn = await advanceToTargetCalories();
      expect(turn.question).not.toContain('anteriormente');
    });

    it('UT-020 an existing full profile pre-fills the question hint for every field', async () => {
      profilesFindByClientId.mockResolvedValue(makeProfile());
      const turn = await advanceToTargetCalories();
      expect(turn.question).toContain('1800 kcal anteriormente');
    });

    it('UT-020 a partially-filled profile (targetCalories previously skipped) pre-fills only what was saved', async () => {
      profilesFindByClientId.mockResolvedValue(
        makeProfile({ targetCalories: null }),
      );
      const turn = await advanceToTargetCalories();
      expect(turn.question).toContain('sem meta definida anteriormente');
    });

    it('UT-022 a pre-filled restrictions value is only ever a hint — the LLM is always asked for it fresh, never auto-applied', async () => {
      profilesFindByClientId.mockResolvedValue(
        makeProfile({ restrictions: 'alergia a leite' }),
      );

      await service.startConversation('client-1', 'prof-1');

      expect(llmNextQuestion).toHaveBeenCalledWith(
        expect.objectContaining({
          answers: { goal: undefined, restrictions: undefined },
          previousAnswers: expect.objectContaining({
            restrictions: 'alergia a leite',
          }),
        }),
      );
    });
  });

  describe('answer — goal/restrictions (LLM-driven)', () => {
    it('UT-016 hands goal/restrictions to MealPlanLlmService.nextQuestion, including the raw answer to interpret', async () => {
      llmNextQuestion.mockResolvedValueOnce({
        answers: { goal: null, restrictions: null },
        field: 'goal',
        question: 'Qual é o objetivo?',
        done: false,
        reprompt: false,
      });
      const turn = (await service.startConversation(
        'client-1',
        'prof-1',
      )) as MealPlanConversationTurnResult;
      expect(turn.field).toBe('goal');

      llmNextQuestion.mockResolvedValueOnce({
        answers: { goal: 'Perda de peso', restrictions: null },
        field: 'restrictions',
        question: 'Tem restrições?',
        done: false,
        reprompt: false,
      });
      const next = (await service.answer(
        'prof-1',
        turn.conversationId,
        'Perda de peso',
      )) as MealPlanConversationTurnResult;

      expect(llmNextQuestion).toHaveBeenLastCalledWith(
        expect.objectContaining({
          pendingField: 'goal',
          pendingRawAnswer: 'Perda de peso',
        }),
      );
      expect(next.field).toBe('restrictions');
    });

    it('UT-021 a "nenhuma" restrictions answer is stored and later sent to generatePlan as that explicit value', async () => {
      await completeConversation('prof-1', 'client-1', '', '3');

      expect(llmGeneratePlan).toHaveBeenCalledWith(
        expect.objectContaining({ restrictions: 'nenhuma' }),
      );
    });
  });

  describe('answer — targetCalories/mealsPerDay (deterministic)', () => {
    it('UT-014 rejects an out-of-range mealsPerDay with a reprompt', async () => {
      const turn1 = await advanceToTargetCalories();
      const turn2 = (await service.answer(
        'prof-1',
        turn1.conversationId,
        '',
      )) as MealPlanConversationTurnResult;
      expect(turn2.field).toBe('mealsPerDay');

      const reprompt = (await service.answer(
        'prof-1',
        turn2.conversationId,
        '0',
      )) as MealPlanConversationTurnResult;
      expect(reprompt.reprompt).toBe(true);
      expect(reprompt.field).toBe('mealsPerDay');
    });

    it('UT-015 an explicitly skipped targetCalories (empty answer) is stored as null', async () => {
      await completeConversation('prof-1', 'client-1', '', '3');

      expect(llmGeneratePlan).toHaveBeenCalledWith(
        expect.objectContaining({ targetCalories: null }),
      );
    });
  });

  describe('completion', () => {
    it('UT-017 calls generatePlan then replaceAllDaysMeals exactly once, with all 7 days', async () => {
      await completeConversation('prof-1', 'client-1', '1800', '3');

      expect(llmGeneratePlan).toHaveBeenCalledTimes(1);
      expect(mealPlansReplaceAllDaysMeals).toHaveBeenCalledTimes(1);
      const [, days] = mealPlansReplaceAllDaysMeals.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(days).toHaveLength(7);
    });

    it('UT-018 a failed generatePlan call never touches the draft', async () => {
      llmGeneratePlan.mockRejectedValue(
        new CodedError('falhou', 502, 'llm_call_failed'),
      );

      await expect(
        completeConversation('prof-1', 'client-1', '1800', '3'),
      ).rejects.toMatchObject({ code: 'llm_call_failed' });
      expect(mealPlansReplaceAllDaysMeals).not.toHaveBeenCalled();
      expect(profilesUpsert).not.toHaveBeenCalled();
    });

    it('UT-019 upserts ClientNutritionProfile with the confirmed answers on completion', async () => {
      await completeConversation('prof-1', 'client-1', '1800', '3');

      expect(profilesUpsert).toHaveBeenCalledWith(
        'client-1',
        expect.objectContaining({
          goal: 'Perda de peso',
          restrictions: 'nenhuma',
          targetCalories: 1800,
          mealsPerDay: 3,
        }),
      );
    });

    it('returns the full draft response once generation succeeds', async () => {
      const result = await completeConversation(
        'prof-1',
        'client-1',
        '1800',
        '3',
      );
      expect(result).toMatchObject({ id: 'plan-1' });
    });
  });

  describe('ownership (shared ConversationStore semantics, UT-002-equivalent)', () => {
    it('a conversationId created for one professional is not usable by another', async () => {
      const turn = await advanceToTargetCalories('client-1', 'prof-1');

      await expect(
        service.answer('prof-2', turn.conversationId, '1800'),
      ).rejects.toBeInstanceOf(AppError);
    });
  });
});
