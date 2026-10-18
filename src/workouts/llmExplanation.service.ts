import { CodedError } from '@/common/errors/codedError';
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

// ADR-012: 3 total attempts, exponential backoff between them.
const RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [500, 1500];

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

  // Up to 3 total attempts with exponential backoff (500ms, then 1500ms) on
  // a transient error (network issue, 5xx) — ADR-012. A 4xx (bad request,
  // invalid key, etc.) fails immediately on the first attempt since
  // retrying it would just reproduce the same rejection.
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (this.isClientError(error) || attempt === RETRY_ATTEMPTS) {
          throw this.llmCallFailed();
        }
        await this.sleep(RETRY_BACKOFF_MS[attempt - 1]);
      }
    }
    throw this.llmCallFailed();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isClientError(error: unknown): boolean {
    return (
      error instanceof OpenAI.APIError &&
      typeof error.status === 'number' &&
      error.status >= 400 &&
      error.status < 500
    );
  }

  // CodedError (not AppError) is deliberate here: AppError's `reason` is
  // never sent to the client (see its own doc comment), but the frontend
  // needs to tell this specific, recoverable failure apart from every
  // other 4xx/5xx this service's callers can throw — a CodedError's `code`
  // is explicitly part of the response body (ADR-008/PRD, this revision).
  private llmCallFailed(): CodedError {
    return new CodedError(GENERATION_FAILED, 502, 'llm_call_failed');
  }

  private parseJsonContent<T>(
    response: OpenAI.Chat.Completions.ChatCompletion,
  ): T {
    const content = response.choices[0]?.message?.content;
    if (!content) throw this.llmCallFailed();
    return JSON.parse(content) as T;
  }
}
