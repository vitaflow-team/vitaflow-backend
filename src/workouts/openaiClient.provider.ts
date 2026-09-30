import { Provider } from '@nestjs/common';
import OpenAI from 'openai';

export const OPENAI_CLIENT = Symbol('OPENAI_CLIENT');

export const openAiClientProvider: Provider = {
  provide: OPENAI_CLIENT,
  useFactory: () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
};
