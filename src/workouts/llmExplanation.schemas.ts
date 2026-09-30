// OpenAI Structured Outputs schemas (response_format: json_schema, strict:
// true) — the model's reply is constrained to these shapes, so callers
// never parse free-form text (task_03 requirement).

export const CONVERSATION_TURN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'object',
      properties: {
        sex: { type: ['string', 'null'], enum: ['MALE', 'FEMALE', null] },
        goal: {
          type: ['string', 'null'],
          enum: [
            'WEIGHT_LOSS',
            'MUSCLE_GAIN',
            'CONDITIONING',
            'MAINTENANCE',
            null,
          ],
        },
        daysPerWeek: { type: ['integer', 'null'] },
        equipment: {
          type: ['string', 'null'],
          enum: ['GYM', 'HOME_BASIC', 'BODYWEIGHT', null],
        },
        restrictions: {
          type: ['array', 'null'],
          items: {
            type: 'string',
            enum: [
              'SHOULDER',
              'KNEE',
              'SPINE',
              'WRIST',
              'HIP',
              'ANKLE',
              'CARDIAC',
            ],
          },
        },
      },
      required: ['sex', 'goal', 'daysPerWeek', 'equipment', 'restrictions'],
      additionalProperties: false,
    },
    field: {
      type: ['string', 'null'],
      enum: ['sex', 'goal', 'daysPerWeek', 'equipment', 'restrictions', null],
    },
    question: { type: 'string' },
    done: { type: 'boolean' },
    reprompt: { type: 'boolean' },
  },
  required: ['answers', 'field', 'question', 'done', 'reprompt'],
  additionalProperties: false,
} as const;

export const EXPLANATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    explanation: { type: 'string' },
  },
  required: ['explanation'],
  additionalProperties: false,
} as const;
