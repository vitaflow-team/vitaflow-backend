import {
  ExerciseEquipment,
  FitnessExperienceLevel,
  FitnessGoal,
  MuscleFocus,
} from '@prisma/client';

// No 'restrictions' (read from the student's FitnessProfile automatically,
// ai-workout-prescription-b2b ADR-003) and no 'sex' (RuleEngineInput never
// takes one at all) — unlike the B2C conversation's field set.
export type EducatorAiWorkoutField =
  | 'goal'
  | 'daysPerWeek'
  | 'equipment'
  | 'experienceLevel'
  | 'muscleFocus';

export type EducatorAiWorkoutMuscleFocusAnswer = MuscleFocus | 'NONE';

export interface EducatorAiWorkoutAnswers {
  goal?: FitnessGoal;
  daysPerWeek?: number;
  equipment?: ExerciseEquipment;
  experienceLevel?: FitnessExperienceLevel;
  muscleFocus?: EducatorAiWorkoutMuscleFocusAnswer;
}

export interface EducatorAiWorkoutConversationState {
  studentId: string;
  // null = create a new EducatorWorkout on completion (ADR-011); set = this
  // conversation is a regenerate targeting that exact, already-existing draft.
  targetWorkoutId: string | null;
  // The target draft's current title, captured once at conversation start so
  // a regenerate preserves whatever the educator renamed it to; null for a
  // brand-new draft (completion then uses the default generated title).
  existingTitle?: string | null;
  answers: EducatorAiWorkoutAnswers;
  pendingField?: EducatorAiWorkoutField;
  pendingRawAnswer?: string;
}

// The LLM's own raw turn shape — never leaves EducatorAiWorkoutLlmService
// as-is, since it has no notion of a conversationId (that's assigned by
// ConversationStore, a service-level concern).
export interface EducatorAiWorkoutConversationTurn {
  answers: EducatorAiWorkoutAnswers;
  field: EducatorAiWorkoutField | null;
  question: string;
  done: boolean;
  reprompt: boolean;
}

// What the controller actually hands back for an in-progress conversation:
// the LLM's turn, plus the conversationId the caller must echo on the next
// call. Without this, the client would have no way to continue a
// conversation past its first question.
export type EducatorAiWorkoutConversationResult =
  EducatorAiWorkoutConversationTurn & {
    conversationId: string;
  };
