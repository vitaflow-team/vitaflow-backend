import { ConversationAnswers, ConversationField } from './llmExplanation.types';

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

// This feature's own `TState` for the shared, generic `ConversationStore`
// (ADR-009) — relocated here from `conversationStore.ts`, unchanged, when
// that file's store class was generalized and moved to
// `src/common/conversation/conversationStore.ts`.
export interface OrchestrationState {
  answers: ConversationAnswers;
  ageKnown: boolean;
  // `undefined` = not yet known/asked; a real value = known (pre-filled
  // from `FitnessProfile` or just answered this conversation) — ADR-015.
  weightKg?: number;
  heightCm?: number;
  sessionDurationMin?: number;
  // `undefined` = not yet asked this conversation; `null` = asked and
  // explicitly skipped; a string = provided (ADR-009/ADR-015). This
  // three-state distinction lives only within one conversation's state —
  // `WorkoutsService.startConversation` collapses a stored `null` back to
  // `undefined` when pre-filling from `FitnessProfile`, the same as
  // `weightKg`/etc., since the column itself can't tell "never asked"
  // apart from "asked and skipped" across conversations.
  restrictionDetail?: string | null;
  // The field the most recently returned question was about; the next
  // `answer()` call's raw text is interpreted as a reply to this field.
  pendingField: OrchestrationField | null;
}

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
