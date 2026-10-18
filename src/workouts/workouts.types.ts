import { ConversationField } from './llmExplanation.types';

// Deterministic, non-LLM steps (ADR-015). `age` is a legacy special case
// (backfills `Users.birthDate`, never part of `FitnessProfile`); `weight`,
// `height`, and `sessionDuration` generalize the same pattern onto
// `FitnessProfile` numeric fields. `restrictionDetail` is also
// deterministic but resolves AFTER the entire LLM-driven phase completes,
// once every LLM-schema field (including `restrictions`) is known.
export type DeterministicField =
  | 'age'
  | 'weight'
  | 'height'
  | 'sessionDuration'
  | 'restrictionDetail';

export type OrchestrationField = DeterministicField | ConversationField;

export interface ConversationTurnResult {
  conversationId: string;
  field: OrchestrationField | null;
  question: string;
  done: boolean;
  reprompt: boolean;
  // True only for the restrictionDetail turn — the frontend renders a skip
  // affordance only when this is true (ADR-015). Every other field stays
  // implicitly mandatory.
  optional: boolean;
}
