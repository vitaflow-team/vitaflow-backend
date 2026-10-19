import { FactoryProvider } from '@nestjs/common';
import OpenAI from 'openai';
import { openAiClientProvider } from './openaiClient.provider';

describe('openAiClientProvider', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalApiKey;
  });

  it("disables the SDK's own retries, leaving LlmExplanationService.withRetry as the single retry layer (ADR-012)", async () => {
    const { useFactory } = openAiClientProvider as FactoryProvider<OpenAI>;
    const client = await useFactory();

    expect(client.maxRetries).toBe(0);
  });
});
