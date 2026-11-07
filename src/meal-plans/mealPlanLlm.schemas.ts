// OpenAI Structured Outputs schemas (response_format: json_schema, strict:
// true) — the model's reply is constrained to these shapes, mirroring
// `CONVERSATION_TURN_JSON_SCHEMA`/`EXPLANATION_JSON_SCHEMA` (vitaflow-llm-calls
// rule 5's sibling pattern), so callers never parse free-form text.

export const MEAL_PLAN_CONVERSATION_TURN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'object',
      properties: {
        goal: { type: ['string', 'null'] },
        // Free text ('nenhuma' is an explicit, valid "no restrictions"
        // answer — ADR-006/US-003.EC-1), never an enum: this codebase has
        // no fixed restriction taxonomy for nutrition the way it does for
        // workout contraindications.
        restrictions: { type: ['string', 'null'] },
      },
      required: ['goal', 'restrictions'],
      additionalProperties: false,
    },
    field: { type: ['string', 'null'], enum: ['goal', 'restrictions', null] },
    question: { type: 'string' },
    done: { type: 'boolean' },
    reprompt: { type: 'boolean' },
  },
  required: ['answers', 'field', 'question', 'done', 'reprompt'],
  additionalProperties: false,
} as const;

export const MEAL_PLAN_GENERATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          weekday: {
            type: 'string',
            enum: [
              'MONDAY',
              'TUESDAY',
              'WEDNESDAY',
              'THURSDAY',
              'FRIDAY',
              'SATURDAY',
              'SUNDAY',
            ],
          },
          meals: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                text: { type: 'string' },
              },
              required: ['label', 'text'],
              additionalProperties: false,
            },
          },
        },
        required: ['weekday', 'meals'],
        additionalProperties: false,
      },
    },
  },
  required: ['days'],
  additionalProperties: false,
} as const;
