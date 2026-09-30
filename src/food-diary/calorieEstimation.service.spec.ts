import { AppError } from '@/utils/app.erro';
import { OPENAI_CLIENT } from '@/workouts/openaiClient.provider';
import { Test, TestingModule } from '@nestjs/testing';
import OpenAI from 'openai';
import { CalorieEstimationService } from './calorieEstimation.service';

function makeCompletion(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

describe('CalorieEstimationService', () => {
  const create = jest.fn();
  let service: CalorieEstimationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalorieEstimationService,
        {
          provide: OPENAI_CLIENT,
          useValue: { chat: { completions: { create } } },
        },
      ],
    }).compile();
    service = module.get(CalorieEstimationService);
  });

  it('UT-001 returns a positive integer estimate from a mocked response', async () => {
    create.mockResolvedValue(makeCompletion({ calories: 420 }));

    const result = await service.estimate('1 banana e 2 ovos mexidos');

    expect(result).toBe(420);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: expect.objectContaining({ type: 'json_schema' }),
      }),
    );
  });

  it('UT-002 still returns a best-effort number for a vague description', async () => {
    create.mockResolvedValue(makeCompletion({ calories: 300 }));

    const result = await service.estimate('comida');

    expect(result).toBe(300);
  });

  it('UT-004 retries once on a transient error then returns successfully', async () => {
    const transientError = new OpenAI.APIError(500, {}, 'Internal error', {});
    create
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(makeCompletion({ calories: 550 }));

    const result = await service.estimate('feijoada completa');

    expect(result).toBe(550);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('UT-004 throws AppError(503) after the retry is exhausted', async () => {
    const transientError = new OpenAI.APIError(500, {}, 'Internal error', {});
    create.mockRejectedValue(transientError);

    const error: AppError = await service
      .estimate('pizza grande')
      .catch((caught: AppError) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toBe('Não foi possível estimar as calorias.');
    expect(error.getStatus()).toBe(503);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not retry on a 4xx response', async () => {
    const clientError = new OpenAI.APIError(400, {}, 'Bad request', {});
    create.mockRejectedValue(clientError);

    await expect(service.estimate('x')).rejects.toBeInstanceOf(AppError);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
