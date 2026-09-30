import { AppError } from '@/utils/app.erro';
import { Test, TestingModule } from '@nestjs/testing';
import { FitnessProfile } from '@prisma/client';
import OpenAI from 'openai';
import { LlmExplanationService } from './llmExplanation.service';
import { OPENAI_CLIENT } from './openaiClient.provider';
import { GeneratedPlan } from './ruleEngine.types';

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
    equipment: 'GYM',
    goal: 'MUSCLE_GAIN',
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

    it('UT-028 retries once on a transient error and returns successfully on the second attempt', async () => {
      const transientError = new OpenAI.APIError(500, {}, 'Internal error', {});
      create
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce(
          makeCompletion({ explanation: 'Plano gerado após nova tentativa.' }),
        );

      const result = await service.explain(plan, makeProfile());

      expect(result).toBe('Plano gerado após nova tentativa.');
      expect(create).toHaveBeenCalledTimes(2);
    });

    it('UT-028 fails after a second consecutive error without a further retry', async () => {
      const transientError = new OpenAI.APIError(500, {}, 'Internal error', {});
      create.mockRejectedValue(transientError);

      await expect(service.explain(plan, makeProfile())).rejects.toBeInstanceOf(
        AppError,
      );
      expect(create).toHaveBeenCalledTimes(2);
    });

    it('UT-028 does not retry on a 4xx response', async () => {
      const clientError = new OpenAI.APIError(400, {}, 'Bad request', {});
      create.mockRejectedValue(clientError);

      await expect(service.explain(plan, makeProfile())).rejects.toBeInstanceOf(
        AppError,
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
  });
});
