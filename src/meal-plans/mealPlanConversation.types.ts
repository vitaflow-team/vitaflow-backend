import { MealPlanDraftResponseDTO } from './dto/mealPlanResponse.Dto';

export interface MealPlanIntakeAnswers {
  goal: string;
  // 'nenhuma' ("none") is an explicit, confirmed answer — never conflated
  // with "not asked yet" (PRD US-003.EC-1, ADR-006).
  restrictions: string;
  // `null` = explicitly skipped (optional field); `undefined` = not yet
  // asked this conversation.
  targetCalories: number | null;
  mealsPerDay: number;
}

export type MealPlanIntakeField = keyof MealPlanIntakeAnswers;

export interface MealPlanOrchestrationState {
  clientId: string;
  answers: Partial<MealPlanIntakeAnswers>;
  pendingField: MealPlanIntakeField | null;
  // The client's existing `ClientNutritionProfile` values, if any (ADR-007)
  // — shown as a hint in each field's question so the nutritionist can
  // confirm or change it (US-002 AC-1), but never copied into `answers`
  // automatically: the generation call only ever uses what's explicitly
  // confirmed THIS conversation (ADR-006, US-003, UT-022), restrictions
  // above all. Absent fields here mean "no prior value" (first-ever
  // intake, or an older, partially-filled profile — US-002.EC-1/EC-2).
  prefill: Partial<MealPlanIntakeAnswers>;
}

// The public, HTTP-facing turn shape — mirrors workouts'
// `ConversationTurnResult` exactly (`conversationId` so the caller can
// continue; `optional` so the frontend renders a skip affordance only for
// `targetCalories`).
export interface MealPlanConversationTurnResult {
  conversationId: string;
  field: MealPlanIntakeField | null;
  question: string;
  done: boolean;
  reprompt: boolean;
  optional: boolean;
}

// What `MealPlanGenerationService.startConversation`/`.answer` return —
// the next turn, or the full draft once intake completes and generation
// succeeds (TechSpec Core Interfaces).
export type MealPlanConversationResult =
  | MealPlanConversationTurnResult
  | MealPlanDraftResponseDTO;
