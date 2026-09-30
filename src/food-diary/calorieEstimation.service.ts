import { OPENAI_CLIENT } from '@/workouts/openaiClient.provider';
import { AppError } from '@/utils/app.erro';
import { Inject, Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { CALORIE_ESTIMATE_JSON_SCHEMA } from './calorieEstimation.schema';

export const OPENAI_MODEL = 'gpt-5-mini';

const ESTIMATE_FAILED = 'Não foi possível estimar as calorias.';

const SYSTEM_PROMPT =
  'Você estima, em quilocalorias, o valor calórico total de uma refeição a ' +
  'partir de uma descrição curta em português. Responda com o melhor ' +
  'número inteiro possível, mesmo que a descrição seja vaga — nunca recuse ' +
  'a estimativa.';

// A thin sibling to the AI Workout Generator's LlmExplanationService,
// reusing the exact same OpenAI client/provider/SDK (never a second
// integration) for an unrelated prompt (ADR-001).
@Injectable()
export class CalorieEstimationService {
  constructor(@Inject(OPENAI_CLIENT) private readonly client: OpenAI) {}

  async estimate(description: string): Promise<number> {
    const response = await this.withRetry(() =>
      this.client.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: description },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'calorie_estimate',
            strict: true,
            schema: CALORIE_ESTIMATE_JSON_SCHEMA,
          },
        },
      }),
    );

    return this.parseJsonContent(response).calories;
  }

  // Same retry-once-then-fail policy as LlmExplanationService: one retry on
  // a transient error, immediate failure on a 4xx.
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (this.isClientError(error)) throw this.toAppError(error);
      try {
        return await operation();
      } catch (retryError) {
        throw this.toAppError(retryError);
      }
    }
  }

  private isClientError(error: unknown): boolean {
    return (
      error instanceof OpenAI.APIError &&
      typeof error.status === 'number' &&
      error.status >= 400 &&
      error.status < 500
    );
  }

  private toAppError(error: unknown): AppError {
    if (error instanceof AppError) return error;
    return new AppError(ESTIMATE_FAILED, 503, 'calorie_estimate_failed');
  }

  private parseJsonContent(response: OpenAI.Chat.Completions.ChatCompletion): {
    calories: number;
  } {
    const content = response.choices[0]?.message?.content;
    if (!content)
      throw new AppError(ESTIMATE_FAILED, 503, 'calorie_estimate_failed');
    return JSON.parse(content) as { calories: number };
  }
}
