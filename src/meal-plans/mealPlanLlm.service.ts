import { CodedError } from '@/common/errors/codedError';
import { OPENAI_CLIENT } from '@/workouts/openaiClient.provider';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Weekday } from '@prisma/client';
import OpenAI from 'openai';
import {
  buildMealPlanConversationPrompt,
  buildMealPlanGenerationPrompt,
  MEAL_PLAN_CONVERSATION_SYSTEM_PROMPT,
  MEAL_PLAN_GENERATION_SYSTEM_PROMPT,
  MealPlanConversationPromptInput,
} from './mealPlanLlm.prompts';
import {
  MEAL_PLAN_CONVERSATION_TURN_JSON_SCHEMA,
  MEAL_PLAN_GENERATION_JSON_SCHEMA,
} from './mealPlanLlm.schemas';
import {
  MealPlanIntakeAnswers,
  MealPlanIntakeField,
} from './mealPlanConversation.types';

// LLM_MODEL overrides the default for dev/test against a non-OpenAI
// endpoint (paired with LLM_BASE_URL in openaiClient.provider.ts) — the same
// override the workout generator reads, since both inject the same client.
export const MEAL_PLAN_OPENAI_MODEL = process.env.LLM_MODEL || 'gpt-5-mini';

const GENERATION_FAILED =
  'Não foi possível gerar o plano alimentar no momento. Tente novamente.';
const WRONG_DAY_COUNT =
  'invalid generatePlan response: expected 7 days, one per Weekday';

// Mirrors LlmExplanationService's own 3-attempt, exponential-backoff policy
// (vitaflow-llm-calls rule 1/2) — a separate constant, not imported from
// workouts (ADR-011: replicate, don't share).
const RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [500, 1500];

export interface MealPlanConversationTurn {
  // The merged answers known after this turn — internal to the
  // conversation orchestration, never sent to the HTTP client directly
  // (mirrors `LlmExplanationService`'s own internal `ConversationTurn`).
  answers: Partial<Pick<MealPlanIntakeAnswers, 'goal' | 'restrictions'>>;
  // Declared as the full `MealPlanIntakeField` (TechSpec Core Interfaces) —
  // in practice this service's own JSON schema only ever returns 'goal',
  // 'restrictions', or null, since `targetCalories`/`mealsPerDay` are
  // deterministic fields this service never asks about.
  field: MealPlanIntakeField | null;
  question: string;
  done: boolean;
  reprompt: boolean;
}

export interface GeneratedMealPlanDay {
  weekday: Weekday;
  meals: { label: string; text: string }[];
}

// Replicates the `vitaflow-llm-calls` five-rule pattern fresh for this
// domain's two call sites (ADR-011) — never shares code with
// `LlmExplanationService`, which stays untouched. Injects the same shared
// `OPENAI_CLIENT` provider `LlmExplanationService`/`calorieEstimation.service`
// already both inject (no new credential).
@Injectable()
export class MealPlanLlmService {
  private readonly logger = new Logger(MealPlanLlmService.name);

  constructor(@Inject(OPENAI_CLIENT) private readonly client: OpenAI) {}

  // `pendingField`/`pendingRawAnswer` carry the free-text reply to
  // interpret, and `previousAnswers` carries this client's prior,
  // *unconfirmed* profile values (ADR-007) purely as a question-phrasing
  // hint — the model must still always ask `restrictions` explicitly
  // (ADR-006/US-003), never treat a `previousAnswers` value as already
  // confirmed.
  async nextQuestion(
    input: MealPlanConversationPromptInput,
  ): Promise<MealPlanConversationTurn> {
    // Built once, outside the closure: a retried attempt resends the same
    // request, it never re-derives it (vitaflow-llm-calls rule 5).
    const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
      {
        model: MEAL_PLAN_OPENAI_MODEL,
        messages: [
          { role: 'system', content: MEAL_PLAN_CONVERSATION_SYSTEM_PROMPT },
          { role: 'user', content: buildMealPlanConversationPrompt(input) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'meal_plan_conversation_turn',
            strict: true,
            schema: MEAL_PLAN_CONVERSATION_TURN_JSON_SCHEMA,
          },
        },
      };
    const response = await this.withRetry(() =>
      this.client.chat.completions.create(request),
    );

    return this.parseJsonContent<MealPlanConversationTurn>(response);
  }

  async generatePlan(
    answers: MealPlanIntakeAnswers,
  ): Promise<GeneratedMealPlanDay[]> {
    const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
      {
        model: MEAL_PLAN_OPENAI_MODEL,
        messages: [
          { role: 'system', content: MEAL_PLAN_GENERATION_SYSTEM_PROMPT },
          { role: 'user', content: buildMealPlanGenerationPrompt(answers) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'meal_plan_generation',
            strict: true,
            schema: MEAL_PLAN_GENERATION_JSON_SCHEMA,
          },
        },
      };
    const response = await this.withRetry(() =>
      this.client.chat.completions.create(request),
    );

    const { days } = this.parseJsonContent<{ days: GeneratedMealPlanDay[] }>(
      response,
    );
    this.assertExactlySevenDays(days);
    return days;
  }

  // The strict JSON schema already constrains each day's shape; this is the
  // one structural rule it can't express (UT-009) — treated as a plain
  // failure, never partially applied.
  private assertExactlySevenDays(days: GeneratedMealPlanDay[]): void {
    const weekdays = new Set(days.map((day) => day.weekday));
    if (days.length !== 7 || weekdays.size !== 7) {
      throw this.llmCallFailed(new Error(WRONG_DAY_COUNT));
    }
  }

  // Up to 3 total attempts with exponential backoff (500ms, then 1500ms) on
  // a transient error — the single retry layer (the SDK's own client
  // already has `maxRetries: 0`, vitaflow-llm-calls rule 1).
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (this.isClientError(error) || attempt === RETRY_ATTEMPTS) {
          throw this.llmCallFailed(error, attempt);
        }
        await this.sleep(RETRY_BACKOFF_MS[attempt - 1]);
      }
    }
    throw this.llmCallFailed(
      new Error('unreachable: loop exits via return or throw above'),
      RETRY_ATTEMPTS,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 429 is retried like a transient failure, *unless* it's an
  // insufficient_quota 429 (billing exhausted, permanent until topped up) —
  // vitaflow-llm-calls rule 2.
  private isClientError(error: unknown): boolean {
    if (!(error instanceof OpenAI.APIError)) return false;
    if (typeof error.status !== 'number') return false;
    if (error.status === 429) return error.type === 'insufficient_quota';
    return error.status >= 400 && error.status < 500;
  }

  // CodedError, not AppError (vitaflow-llm-calls rule 4 / backend-conventions
  // §7) — logs the real upstream error before converting it (rule 3).
  private llmCallFailed(error?: unknown, attempt?: number): CodedError {
    this.logger.error(
      `llm_call_failed attempt=${attempt ?? 'n/a'} ${this.describeError(error)}`,
    );
    return new CodedError(GENERATION_FAILED, 502, 'llm_call_failed');
  }

  private describeError(error: unknown): string {
    if (error instanceof OpenAI.APIError) {
      return `status=${error.status} code=${error.code ?? 'n/a'} type=${error.type ?? 'n/a'} message=${error.message}`;
    }
    if (error instanceof Error) {
      return `${error.constructor.name}: ${error.message}`;
    }
    return `non-error thrown: ${String(error)}`;
  }

  private parseJsonContent<T>(
    response: OpenAI.Chat.Completions.ChatCompletion,
  ): T {
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw this.llmCallFailed(new Error('empty content in OpenAI response'));
    }
    try {
      return JSON.parse(content) as T;
    } catch (error) {
      throw this.llmCallFailed(error);
    }
  }
}
