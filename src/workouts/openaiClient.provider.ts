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
  useFactory: () =>
    new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 }),
};
