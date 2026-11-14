import { Test, TestingModule } from '@nestjs/testing';
import OpenAI from 'openai';
import { CodedError } from '@/common/errors/codedError';
import { OPENAI_CLIENT } from '@/workouts/openaiClient.provider';
import { EducatorAiWorkoutLlmService } from './educatorAiWorkoutLlm.service';
import { EDUCATOR_AI_WORKOUT_FIELD_ORDER } from './educatorAiWorkoutConversation.prompts';
import { EducatorAiWorkoutConversationState } from './educatorAiWorkoutConversation.types';

function makeCompletion(content: unknown) {
  return {
    choices: [{ message: { content: JSON.stringify(content) } }],
  };
}

const EMPTY_STATE: EducatorAiWorkoutConversationState = {
  studentId: 'student-1',
  targetWorkoutId: null,
  answers: {},
};

describe('EducatorAiWorkoutLlmService', () => {
  const create = jest.fn();
  let service: EducatorAiWorkoutLlmService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EducatorAiWorkoutLlmService,
        {
          provide: OPENAI_CLIENT,
          useValue: { chat: { completions: { create } } },
        },
      ],
    }).compile();
    service = module.get(EducatorAiWorkoutLlmService);
  });

  describe('nextQuestion', () => {
    // UT-004
    it('asks for goal first, given an empty conversation state', async () => {
      create.mockResolvedValue(
        makeCompletion({
          answers: {},
          field: 'goal',
          question: 'Qual é o objetivo do aluno?',
          done: false,
          reprompt: false,
        }),
      );

      const result = await service.nextQuestion(EMPTY_STATE);

      expect(result.field).toBe('goal');
      expect(EDUCATOR_AI_WORKOUT_FIELD_ORDER[0]).toBe('goal');
    });

    // UT-005
    it('never includes restrictions or sex in the field order', () => {
      expect(EDUCATOR_AI_WORKOUT_FIELD_ORDER).not.toContain('restrictions');
      expect(EDUCATOR_AI_WORKOUT_FIELD_ORDER).not.toContain('sex');
      expect(EDUCATOR_AI_WORKOUT_FIELD_ORDER).toEqual([
        'goal',
        'daysPerWeek',
        'equipment',
        'experienceLevel',
        'muscleFocus',
      ]);
    });

    // UT-007
    it('succeeds after exactly one retry when the first attempt fails with a 500', async () => {
      jest.useFakeTimers();
      const transientError = new OpenAI.APIError(500, {}, 'Internal error', {});
      create.mockRejectedValueOnce(transientError).mockResolvedValueOnce(
        makeCompletion({
          answers: {},
          field: 'daysPerWeek',
          question: 'Quantos dias por semana?',
          done: false,
          reprompt: false,
        }),
      );

      const resultPromise = service.nextQuestion(EMPTY_STATE);
      await jest.advanceTimersByTimeAsync(500);
      const result = await resultPromise;

      expect(result.field).toBe('daysPerWeek');
      expect(create).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });

    // UT-008
    it('fails immediately on a 400, without retrying', async () => {
      const clientError = new OpenAI.APIError(400, {}, 'Bad request', {});
      create.mockRejectedValue(clientError);

      await expect(service.nextQuestion(EMPTY_STATE)).rejects.toBeInstanceOf(
        CodedError,
      );
      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  describe('explain', () => {
    // UT-006
    it('returns null and never throws when every retry attempt fails', async () => {
      jest.useFakeTimers();
      const transientError = new OpenAI.APIError(500, {}, 'Internal error', {});
      create.mockRejectedValue(transientError);

      const resultPromise = service.explain(3, [5, 5, 5], false, {
        goal: 'MUSCLE_GAIN',
      });
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(1500);
      const result = await resultPromise;

      expect(result).toBeNull();
      jest.useRealTimers();
    });

    it('returns the parsed explanation on success', async () => {
      create.mockResolvedValue(
        makeCompletion({ explanation: 'Plano equilibrado para o objetivo.' }),
      );

      const result = await service.explain(3, [5, 5, 5], false, {
        goal: 'MUSCLE_GAIN',
      });

      expect(result).toBe('Plano equilibrado para o objetivo.');
    });
  });
});
