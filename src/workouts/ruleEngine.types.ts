import {
  ExerciseEquipment,
  ExerciseContraindication,
  FitnessGoal,
} from '@prisma/client';

export interface RuleEngineInput {
  goal: FitnessGoal;
  daysPerWeek: number;
  equipment: ExerciseEquipment;
  restrictions: ExerciseContraindication[];
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
