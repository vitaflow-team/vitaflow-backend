import { CodedError } from '@/common/errors/codedError';
import { OPENAI_CLIENT } from '@/workouts/openaiClient.provider';
import { Test, TestingModule } from '@nestjs/testing';
import { Weekday } from '@prisma/client';
import OpenAI from 'openai';
import { MealPlanIntakeAnswers } from './mealPlanConversation.types';
import { MealPlanLlmService } from './mealPlanLlm.service';

function completion(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

function makeDays() {
  return (Object.values(Weekday) as Weekday[]).map((weekday) => ({
    weekday,
    meals: [{ label: 'Almoço', text: 'Arroz, feijão e frango' }],
  }));
}

const ANSWERS: MealPlanIntakeAnswers = {
  goal: 'Perda de peso',
  restrictions: 'nenhuma',
  targetCalories: 1800,
  mealsPerDay: 3,
};

describe('MealPlanLlmService', () => {
  const create = jest.fn();
  let service: MealPlanLlmService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MealPlanLlmService,
        {
          provide: OPENAI_CLIENT,
          useValue: { chat: { completions: { create } } },
        },
      ],
    }).compile();
    service = module.get(MealPlanLlmService);
  });

  describe('nextQuestion', () => {
    it('UT-005 given partial answers, returns the next unanswered field’s question', async () => {
      create.mockResolvedValue(
        completion({
          answers: { goal: null, restrictions: null },
          field: 'goal',
          question: 'Qual é o objetivo do paciente?',
          done: false,
          reprompt: false,
        }),
      );

      const turn = await service.nextQuestion({
        answers: {},
        previousAnswers: {},
      });

      expect(turn.field).toBe('goal');
      expect(turn.done).toBe(false);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: expect.objectContaining({ type: 'json_schema' }),
        }),
      );
    });

    it('signals reprompt when the pending raw answer could not be parsed', async () => {
      create.mockResolvedValue(
        completion({
          answers: { goal: null, restrictions: null },
          field: 'restrictions',
          question: 'O paciente tem alguma restrição alimentar?',
          done: false,
          reprompt: true,
        }),
      );

      const turn = await service.nextQuestion({
        answers: {},
        previousAnswers: {},
        pendingField: 'restrictions',
        pendingRawAnswer: '???',
      });

      expect(turn.reprompt).toBe(true);
      expect(turn.field).toBe('restrictions');
    });
  });

  describe('generatePlan', () => {
    it('UT-006 given complete answers, returns exactly 7 GeneratedMealPlanDay entries, one per Weekday', async () => {
      create.mockResolvedValue(completion({ days: makeDays() }));

      const days = await service.generatePlan(ANSWERS);

      expect(days).toHaveLength(7);
      expect(new Set(days.map((d) => d.weekday)).size).toBe(7);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: expect.objectContaining({ type: 'json_schema' }),
        }),
      );
    });

    it('UT-006 includes the confirmed restrictions as an explicit field on the request (ADR-006)', async () => {
      create.mockResolvedValue(completion({ days: makeDays() }));

      await service.generatePlan({
        ...ANSWERS,
        restrictions: 'alergia a amendoim',
      });

      const callArgs = create.mock.calls[0][0];
      const userMessage = callArgs.messages.find(
        (message: { role: string }) => message.role === 'user',
      );
      expect(userMessage.content).toContain('alergia a amendoim');
    });

    it('UT-009 a response with the wrong day count is treated as a failure, not partially parsed', async () => {
      create.mockResolvedValue(completion({ days: makeDays().slice(0, 6) }));

      await expect(service.generatePlan(ANSWERS)).rejects.toBeInstanceOf(
        CodedError,
      );
      await expect(service.generatePlan(ANSWERS)).rejects.toMatchObject({
        code: 'llm_call_failed',
      });
    });

    it('UT-007 retries a 429 (rate limited) like a transient failure', async () => {
      jest.useFakeTimers();
      const rateLimited = new OpenAI.APIError(429, {}, 'Rate limited', {});
      create
        .mockRejectedValueOnce(rateLimited)
        .mockResolvedValueOnce(completion({ days: makeDays() }));

      const resultPromise = service.generatePlan(ANSWERS);
      await jest.advanceTimersByTimeAsync(500);
      const result = await resultPromise;

      expect(result).toHaveLength(7);
      expect(create).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });

    it('UT-008 does not retry an insufficient_quota 429 (billing exhausted)', async () => {
      const quotaExhausted = new OpenAI.APIError(
        429,
        {
          code: 'credit_balance_exhausted',
          type: 'insufficient_quota',
          message: 'You have no credits remaining.',
        },
        'You have no credits remaining.',
        {},
      );
      create.mockRejectedValue(quotaExhausted);

      await expect(service.generatePlan(ANSWERS)).rejects.toBeInstanceOf(
        CodedError,
      );
      await expect(service.generatePlan(ANSWERS)).rejects.toMatchObject({
        code: 'llm_call_failed',
      });
      expect(create).toHaveBeenCalledTimes(2);
    });

    it('UT-010 builds the request once per call, never rebuilding it on retry', async () => {
      jest.useFakeTimers();
      const transientError = new OpenAI.APIError(500, {}, 'Internal error', {});
      create
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce(completion({ days: makeDays() }));

      const resultPromise = service.generatePlan(ANSWERS);
      await jest.advanceTimersByTimeAsync(500);
      await resultPromise;

      const [firstCallArgs] = create.mock.calls[0];
      const [secondCallArgs] = create.mock.calls[1];
      expect(firstCallArgs).toEqual(secondCallArgs);
      jest.useRealTimers();
    });

    it('fails after 3 consecutive transient errors, with no 4th attempt', async () => {
      jest.useFakeTimers();
      const transientError = new OpenAI.APIError(500, {}, 'Internal error', {});
      create.mockRejectedValue(transientError);

      const resultPromise = service.generatePlan(ANSWERS);
      const assertion =
        expect(resultPromise).rejects.toBeInstanceOf(CodedError);
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(1500);
      await assertion;

      expect(create).toHaveBeenCalledTimes(3);
      jest.useRealTimers();
    });
  });
});
