import {
  ExerciseContraindication,
  ExerciseEquipment,
  FitnessGoal,
  Sex,
} from '@prisma/client';

export type ConversationField =
  | 'sex'
  | 'goal'
  | 'daysPerWeek'
  | 'equipment'
  | 'restrictions';

export interface ConversationAnswers {
  sex?: Sex;
  goal?: FitnessGoal;
  daysPerWeek?: number;
  equipment?: ExerciseEquipment;
  restrictions?: ExerciseContraindication[];
}

export interface ConversationState {
  // Fields already known — pre-filled by the caller (WorkoutsService, Task 4)
  // from `FitnessProfile`, except `goal`, which ADR-003 always re-asks — or
  // captured from earlier turns of this same conversation.
  answers: ConversationAnswers;
  // The field the most recently asked question was about, and the user's
  // raw free-text reply to it. Present only when resuming after an answer;
  // absent on the very first call, which just asks the first question.
  pendingField?: ConversationField;
  pendingRawAnswer?: string;
}

export interface ConversationTurn {
  // The answers known after this turn: `state.answers` merged with
  // whatever `pendingRawAnswer` was successfully parsed into.
  answers: ConversationAnswers;
  // The next field to ask about; null once every field is known.
  field: ConversationField | null;
  // Portuguese question text for `field`; empty when `done`.
  question: string;
  done: boolean;
  // True when `pendingRawAnswer` could not be parsed for `pendingField` —
  // the caller should re-ask the same field rather than advance.
  reprompt: boolean;
}
