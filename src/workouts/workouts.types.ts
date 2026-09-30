import { ConversationField } from './llmExplanation.types';

// `age` is a WorkoutsService-local step (US-001.EC-1): it backfills
// `Users.birthDate` when missing, and is never part of `FitnessProfile`, so
// it is handled here rather than inside LlmExplanationService's structured
// schema (Task 3), which only knows about the fitness-profile fields.
export type OrchestrationField = 'age' | ConversationField;

export interface ConversationTurnResult {
  conversationId: string;
  field: OrchestrationField | null;
  question: string;
  done: boolean;
  reprompt: boolean;
}
