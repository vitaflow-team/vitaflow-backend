import { Provider } from '@nestjs/common';
import OpenAI from 'openai';

export const OPENAI_CLIENT = Symbol('OPENAI_CLIENT');

export const openAiClientProvider: Provider = {
  provide: OPENAI_CLIENT,
  // maxRetries: 0 — the SDK's own default (2 retries, i.e. 3 attempts per
  // call) would stack underneath LlmExplanationService.withRetry's own
  // 3-attempt policy (ADR-012), turning it into an uncontrolled 3x3 = up
  // to 9 HTTP calls per conversation turn, with the SDK's own retry list
  // including 429 — amplifying the exact rate-limit pressure the policy
  // is meant to recover from. withRetry is the single retry layer.
  //
  // LLM_BASE_URL is unset in production, so the SDK talks to OpenAI
  // directly (its own default). Setting it points the same client at any
  // OpenAI-compatible endpoint (e.g. OpenRouter for free-tier dev/test
  // models, see vitaflow-llm-calls) — OPENAI_API_KEY then holds that
  // endpoint's key, not necessarily an OpenAI one.
  useFactory: () =>
    new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.LLM_BASE_URL || undefined,
      maxRetries: 0,
    }),
};
