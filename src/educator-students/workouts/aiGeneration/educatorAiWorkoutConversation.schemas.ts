// OpenAI Structured Outputs schemas (response_format: json_schema, strict:
// true), mirroring llmExplanation.schemas.ts's shape for this feature's own
// (smaller) field set — no 'sex', no 'restrictions'.

export const EDUCATOR_AI_WORKOUT_CONVERSATION_TURN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'object',
      properties: {
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
        experienceLevel: {
          type: ['string', 'null'],
          enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', null],
        },
        muscleFocus: {
          type: ['string', 'null'],
          enum: ['CHEST', 'BACK', 'LEGS', 'SHOULDERS', 'ABDOMEN', 'NONE', null],
        },
      },
      required: [
        'goal',
        'daysPerWeek',
        'equipment',
        'experienceLevel',
        'muscleFocus',
      ],
      additionalProperties: false,
    },
    field: {
      type: ['string', 'null'],
      enum: [
        'goal',
        'daysPerWeek',
        'equipment',
        'experienceLevel',
        'muscleFocus',
        null,
      ],
    },
    question: { type: 'string' },
    done: { type: 'boolean' },
    reprompt: { type: 'boolean' },
  },
  required: ['answers', 'field', 'question', 'done', 'reprompt'],
  additionalProperties: false,
} as const;

export const EDUCATOR_AI_WORKOUT_EXPLANATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    explanation: { type: 'string' },
  },
  required: ['explanation'],
  additionalProperties: false,
} as const;
