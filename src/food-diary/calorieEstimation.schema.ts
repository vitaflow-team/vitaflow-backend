// OpenAI Structured Outputs schema (response_format: json_schema, strict:
// true), mirroring the AI Workout Generator's LlmExplanationService pattern.
export const CALORIE_ESTIMATE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    calories: { type: 'integer' },
  },
  required: ['calories'],
  additionalProperties: false,
} as const;
