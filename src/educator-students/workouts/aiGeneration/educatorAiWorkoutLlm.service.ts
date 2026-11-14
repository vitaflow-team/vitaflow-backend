import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { CodedError } from '@/common/errors/codedError';
import { OPENAI_CLIENT } from '@/workouts/openaiClient.provider';
import {
  buildEducatorAiWorkoutConversationPrompt,
  buildEducatorAiWorkoutExplanationPrompt,
  EDUCATOR_AI_WORKOUT_CONVERSATION_SYSTEM_PROMPT,
  EDUCATOR_AI_WORKOUT_EXPLANATION_SYSTEM_PROMPT,
} from './educatorAiWorkoutConversation.prompts';
import {
  EDUCATOR_AI_WORKOUT_CONVERSATION_TURN_JSON_SCHEMA,
  EDUCATOR_AI_WORKOUT_EXPLANATION_JSON_SCHEMA,
} from './educatorAiWorkoutConversation.schemas';
import {
  EducatorAiWorkoutAnswers,
  EducatorAiWorkoutConversationState,
  EducatorAiWorkoutConversationTurn,
} from './educatorAiWorkoutConversation.types';

// LLM_MODEL overrides the default for dev/test against a non-OpenAI
// endpoint (paired with LLM_BASE_URL in openaiClient.provider.ts) — same
// override this codebase's other 2 LLM services already read.
export const EDUCATOR_AI_WORKOUT_OPENAI_MODEL =
  process.env.LLM_MODEL || 'gpt-5-mini';

const GENERATION_FAILED =
  'Não foi possível gerar o treino no momento. Tente novamente.';

// ai-workout-prescription-b2b: 3 total attempts, exponential backoff between
// them — independently declared here (vitaflow-llm-calls skill, ADR-011:
// replicate, never share code with LlmExplanationService/MealPlanLlmService).
const RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [500, 1500];

/**
 * Runs the AI-generation conversational intake and writes the plan's
 * educator-only prose explanation — never selects exercises (that is
 * RuleEngineService's exclusive job, PRD ADR-001). This is the third
 * independent replication of the project's `withRetry`/`isClientError`/
 * `CodedError` LLM-call pattern (vitaflow-llm-calls skill).
 */
@Injectable()
export class EducatorAiWorkoutLlmService {
  private readonly logger = new Logger(EducatorAiWorkoutLlmService.name);

  constructor(@Inject(OPENAI_CLIENT) private readonly client: OpenAI) {}

  async nextQuestion(
    state: EducatorAiWorkoutConversationState,
  ): Promise<EducatorAiWorkoutConversationTurn> {
    const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
      {
        model: EDUCATOR_AI_WORKOUT_OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content: EDUCATOR_AI_WORKOUT_CONVERSATION_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: buildEducatorAiWorkoutConversationPrompt(state),
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'educator_ai_workout_conversation_turn',
            strict: true,
            schema: EDUCATOR_AI_WORKOUT_CONVERSATION_TURN_JSON_SCHEMA,
          },
        },
      };
    const response = await this.withRetry(() =>
      this.client.chat.completions.create(request),
    );

    return this.parseJsonContent<EducatorAiWorkoutConversationTurn>(response);
  }

  // Degrades to null on failure, never throws (PRD business rule: the
  // explanation failing must never block the already-decided, rule-engine-
  // generated draft from being saved) — the one deliberate deviation from
  // the other 2 LLM services, which always throw on final failure.
  async explain(
    daysPerWeek: number,
    exercisesPerDay: number[],
    scaled: boolean,
    answers: EducatorAiWorkoutAnswers,
  ): Promise<string | null> {
    const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
      {
        model: EDUCATOR_AI_WORKOUT_OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content: EDUCATOR_AI_WORKOUT_EXPLANATION_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: buildEducatorAiWorkoutExplanationPrompt(
              daysPerWeek,
              exercisesPerDay,
              scaled,
              answers,
            ),
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'educator_ai_workout_explanation',
            strict: true,
            schema: EDUCATOR_AI_WORKOUT_EXPLANATION_JSON_SCHEMA,
          },
        },
      };
    try {
      const response = await this.withRetry(() =>
        this.client.chat.completions.create(request),
      );
      return this.parseJsonContent<{ explanation: string }>(response)
        .explanation;
    } catch (error) {
      this.logger.warn(
        `educator_ai_workout_explanation_failed ${this.describeError(error)}`,
      );
      return null;
    }
  }

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

  private isClientError(error: unknown): boolean {
    if (!(error instanceof OpenAI.APIError)) return false;
    if (typeof error.status !== 'number') return false;
    if (error.status === 429) return error.type === 'insufficient_quota';
    return error.status >= 400 && error.status < 500;
  }

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
    return JSON.parse(content) as T;
  }
}
