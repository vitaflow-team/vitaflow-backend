import { AppError } from '@/utils/app.erro';
import { Inject, Injectable } from '@nestjs/common';
import { FitnessProfile } from '@prisma/client';
import OpenAI from 'openai';
import {
  buildConversationPrompt,
  buildExplanationPrompt,
  CONVERSATION_SYSTEM_PROMPT,
  EXPLANATION_SYSTEM_PROMPT,
} from './llmExplanation.prompts';
import {
  CONVERSATION_TURN_JSON_SCHEMA,
  EXPLANATION_JSON_SCHEMA,
} from './llmExplanation.schemas';
import { ConversationState, ConversationTurn } from './llmExplanation.types';
import { OPENAI_CLIENT } from './openaiClient.provider';
import { GeneratedPlan } from './ruleEngine.types';

export const OPENAI_MODEL = 'gpt-5-mini';

const GENERATION_FAILED =
  'Não foi possível gerar o treino no momento. Tente novamente.';

// Runs the conversational intake and writes the plan's prose explanation —
// never selects exercises (that is RuleEngineService's exclusive job,
// ADR-001).
@Injectable()
export class LlmExplanationService {
  constructor(@Inject(OPENAI_CLIENT) private readonly client: OpenAI) {}

  async nextQuestion(state: ConversationState): Promise<ConversationTurn> {
    const response = await this.withRetry(() =>
      this.client.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: CONVERSATION_SYSTEM_PROMPT },
          { role: 'user', content: buildConversationPrompt(state) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'conversation_turn',
            strict: true,
            schema: CONVERSATION_TURN_JSON_SCHEMA,
          },
        },
      }),
    );

    return this.parseJsonContent<ConversationTurn>(response);
  }

  async explain(plan: GeneratedPlan, profile: FitnessProfile): Promise<string> {
    const response = await this.withRetry(() =>
      this.client.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: EXPLANATION_SYSTEM_PROMPT },
          { role: 'user', content: buildExplanationPrompt(plan, profile) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'workout_explanation',
            strict: true,
            schema: EXPLANATION_JSON_SCHEMA,
          },
        },
      }),
    );

    return this.parseJsonContent<{ explanation: string }>(response).explanation;
  }

  // One retry on a transient error (network issue, 5xx); a 4xx (bad
  // request, invalid key, etc.) fails immediately since retrying it would
  // just reproduce the same rejection.
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
    return new AppError(GENERATION_FAILED, 502, 'llm_call_failed');
  }

  private parseJsonContent<T>(
    response: OpenAI.Chat.Completions.ChatCompletion,
  ): T {
    const content = response.choices[0]?.message?.content;
    if (!content) throw new AppError(GENERATION_FAILED, 502, 'llm_call_failed');
    return JSON.parse(content) as T;
  }
}
