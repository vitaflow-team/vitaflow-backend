import { CodedError } from '@/common/errors/codedError';
import { Inject, Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(LlmExplanationService.name);

  constructor(@Inject(OPENAI_CLIENT) private readonly client: OpenAI) {}

  async nextQuestion(state: ConversationState): Promise<ConversationTurn> {
    // Built once, outside the closure: a retried attempt resends the same
    // request, it never re-derives it (the prompt-building work shouldn't
    // scale with RETRY_ATTEMPTS).
    const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
      {
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
      };
    const response = await this.withRetry(() =>
      this.client.chat.completions.create(request),
    );

    return this.parseJsonContent<ConversationTurn>(response);
  }

  async explain(plan: GeneratedPlan, profile: FitnessProfile): Promise<string> {
    const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
      {
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
      };
    const response = await this.withRetry(() =>
      this.client.chat.completions.create(request),
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

  // 429 is retried like a transient failure (ADR-012: the retry policy
  // should absorb "momentary rate-limit backpressure" invisibly) *unless*
  // it's an insufficient_quota 429 — OpenAI's billing-exhausted response
  // (observed in production: code=credit_balance_exhausted, "You have no
  // credits remaining"). That one is permanent until the account is
  // topped up; retrying it 3 times just reproduces the same rejection
  // 3 times, wasting ~2s of latency for nothing. Other 4xx's (bad
  // request, invalid key) stay non-retryable for the same reason.
  private isClientError(error: unknown): boolean {
    if (!(error instanceof OpenAI.APIError)) return false;
    if (typeof error.status !== 'number') return false;
    if (error.status === 429) return error.type === 'insufficient_quota';
    return error.status >= 400 && error.status < 500;
  }

  // code-standards: backend-code.md §7 ("always AppError, never a raw
  // HttpException subtype") — CodedError is used deliberately instead.
  // AppError's `reason` is never sent to the client (see its own doc
  // comment), so it structurally cannot carry the distinguishable `code`
  // PRD ADR-008 requires the frontend to match on; CodedError is this
  // codebase's own, already-dominant mechanism for exactly that need (its
  // own doc comment: "a client can tell apart two failures that share a
  // status"), used by ~30 other services — §7 predates that pattern.
  // Logs the real OpenAI failure (status, code, message) before converting
  // it to the generic client-facing CodedError — without this, a 502 in
  // production is undiagnosable: the client only ever sees GENERATION_FAILED.
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
