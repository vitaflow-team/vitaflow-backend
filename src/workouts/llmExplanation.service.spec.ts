import { CodedError } from '@/common/errors/codedError';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FitnessProfile } from '@prisma/client';
import OpenAI from 'openai';
import { LlmExplanationService } from './llmExplanation.service';
import { OPENAI_CLIENT } from './openaiClient.provider';
import { GeneratedPlan } from './ruleEngine.types';
import { CONVERSATION_TURN_JSON_SCHEMA } from './llmExplanation.schemas';

function makeCompletion(content: unknown) {
  return {
    choices: [{ message: { content: JSON.stringify(content) } }],
  };
}

function makeProfile(overrides: Partial<FitnessProfile> = {}): FitnessProfile {
  const timestamp = new Date('2026-09-30T09:00:00.000Z');
  return {
    id: 'profile-1',
    userId: 'user-1',
    sex: 'MALE',
    restrictions: [],
    restrictionDetail: null,
    equipment: 'GYM',
    goal: 'MUSCLE_GAIN',
    weightKg: null,
    heightCm: null,
    experienceLevel: null,
    sessionDurationMin: null,
    muscleFocus: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

const plan: GeneratedPlan = {
  scaled: false,
  days: [
    {
      dayOfWeek: 1,
      exercises: [{ exerciseId: 'exercise-1', sets: 4, reps: 8, order: 1 }],
    },
  ],
};

describe('LlmExplanationService', () => {
  const create = jest.fn();
  let service: LlmExplanationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmExplanationService,
        {
          provide: OPENAI_CLIENT,
          useValue: { chat: { completions: { create } } },
        },
      ],
    }).compile();
    service = module.get(LlmExplanationService);
  });

  describe('explain', () => {
    it('UT-027 returns the parsed prose string from a structured response', async () => {
      create.mockResolvedValue(
        makeCompletion({ explanation: 'Plano focado em ganho de massa.' }),
      );

      const result = await service.explain(plan, makeProfile());

      expect(result).toBe('Plano focado em ganho de massa.');
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: expect.objectContaining({ type: 'json_schema' }),
        }),
      );
    });

    it('UT-027 includes restrictionDetail in the prompt when present', async () => {
      create.mockResolvedValue(makeCompletion({ explanation: 'Plano.' }));

      await service.explain(
        plan,
        makeProfile({ restrictionDetail: 'tendinite no ombro direito' }),
      );

      const callArgs = create.mock.calls[0][0];
      const userMessage = callArgs.messages.find(
        (message: { role: string }) => message.role === 'user',
      );
      expect(userMessage.content).toContain('tendinite no ombro direito');
    });

    it('UT-028 (ADR-012) succeeds on the third attempt after two transient failures, with exponential backoff', async () => {
      jest.useFakeTimers();
      const transientError = new OpenAI.APIError(500, {}, 'Internal error', {});
      create
        .mockRejectedValueOnce(transientError)
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce(
          makeCompletion({
            explanation: 'Plano gerado na terceira tentativa.',
          }),
        );

      const resultPromise = service.explain(plan, makeProfile());
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(1500);
      const result = await resultPromise;

      expect(result).toBe('Plano gerado na terceira tentativa.');
      expect(create).toHaveBeenCalledTimes(3);
      jest.useRealTimers();
    });

    it('UT-028 (ADR-012) fails after 3 consecutive errors, with no 4th attempt', async () => {
      jest.useFakeTimers();
      const transientError = new OpenAI.APIError(500, {}, 'Internal error', {});
      create.mockRejectedValue(transientError);

      const resultPromise = service.explain(plan, makeProfile());
      const assertion =
        expect(resultPromise).rejects.toBeInstanceOf(CodedError);
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(1500);
      await assertion;
      await expect(resultPromise).rejects.toMatchObject({
        code: 'llm_call_failed',
      });

      expect(create).toHaveBeenCalledTimes(3);
      jest.useRealTimers();
    });

    it('UT-036 does not retry on a 4xx response', async () => {
      const clientError = new OpenAI.APIError(400, {}, 'Bad request', {});
      create.mockRejectedValue(clientError);

      await expect(service.explain(plan, makeProfile())).rejects.toBeInstanceOf(
        CodedError,
      );
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('logs the real OpenAI status/code/message instead of swallowing it', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const clientError = new OpenAI.APIError(
        401,
        { code: 'invalid_api_key', message: 'Incorrect API key provided' },
        'Incorrect API key provided',
        {},
      );
      create.mockRejectedValue(clientError);

      await expect(service.explain(plan, makeProfile())).rejects.toBeInstanceOf(
        CodedError,
      );

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('status=401'),
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Incorrect API key provided'),
      );
      errorSpy.mockRestore();
    });

    it('retries a 429 (rate limited) like a transient failure, per ADR-012', async () => {
      jest.useFakeTimers();
      const rateLimited = new OpenAI.APIError(429, {}, 'Rate limited', {});
      create
        .mockRejectedValueOnce(rateLimited)
        .mockResolvedValueOnce(
          makeCompletion({ explanation: 'Plano gerado após rate limit.' }),
        );

      const resultPromise = service.explain(plan, makeProfile());
      await jest.advanceTimersByTimeAsync(500);
      const result = await resultPromise;

      expect(result).toBe('Plano gerado após rate limit.');
      expect(create).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });

    it('does not retry an insufficient_quota 429 (billing exhausted, permanent until topped up)', async () => {
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

      await expect(service.explain(plan, makeProfile())).rejects.toBeInstanceOf(
        CodedError,
      );
      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  describe('nextQuestion', () => {
    it('returns the next field, question and merged answers from the structured response', async () => {
      create.mockResolvedValue(
        makeCompletion({
          answers: { sex: 'MALE' },
          field: 'goal',
          question: 'Qual é o seu objetivo?',
          done: false,
          reprompt: false,
        }),
      );

      const turn = await service.nextQuestion({ answers: {} });

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
        makeCompletion({
          answers: {},
          field: 'daysPerWeek',
          question: 'Quantos dias por semana você pode treinar?',
          done: false,
          reprompt: true,
        }),
      );

      const turn = await service.nextQuestion({
        answers: {},
        pendingField: 'daysPerWeek',
        pendingRawAnswer: 'xyz123',
      });

      expect(turn.reprompt).toBe(true);
      expect(turn.field).toBe('daysPerWeek');
    });

    it('UT-037 the conversation turn schema includes experienceLevel and muscleFocus with the NONE sentinel', () => {
      const answerProps = CONVERSATION_TURN_JSON_SCHEMA.properties.answers
        .properties as Record<string, { enum?: readonly unknown[] }>;

      expect(answerProps.experienceLevel.enum).toEqual([
        'BEGINNER',
        'INTERMEDIATE',
        'ADVANCED',
        null,
      ]);
      expect(answerProps.muscleFocus.enum).toEqual(
        expect.arrayContaining([
          'CHEST',
          'BACK',
          'LEGS',
          'SHOULDERS',
          'ABDOMEN',
          'NONE',
        ]),
      );
      expect(answerProps.muscleFocus.enum).toContain(null);
    });
  });
});
