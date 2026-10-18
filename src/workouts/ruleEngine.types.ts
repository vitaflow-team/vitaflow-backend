import {
  ExerciseEquipment,
  ExerciseContraindication,
  FitnessExperienceLevel,
  FitnessGoal,
  MuscleFocus,
} from '@prisma/client';

export interface RuleEngineInput {
  goal: FitnessGoal;
  daysPerWeek: number;
  equipment: ExerciseEquipment;
  restrictions: ExerciseContraindication[];
  // Both are soft preferences, never exclusions (ADR-013): a miss on either
  // never shrinks the candidate pool the NOT_ENOUGH_EXERCISES check reads.
  experienceLevel?: FitnessExperienceLevel;
  muscleFocus?: MuscleFocus;
}

export interface GeneratedWorkoutExercise {
  exerciseId: string;
  sets: number;
  reps: number;
  order: number;
}

export interface GeneratedWorkoutDay {
  dayOfWeek: number;
  exercises: GeneratedWorkoutExercise[];
}

export interface GeneratedPlan {
  days: GeneratedWorkoutDay[];
  // True when the catalog didn't have enough matching exercises to fill
  // every day at the target count, so days were given fewer exercises
  // instead of failing (PRD US-003 EC-1).
  scaled: boolean;
}
