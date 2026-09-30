import { WorkoutInput } from '@/repositories/workouts/workouts.repository';
import { FitnessGoal } from '@prisma/client';
import { GeneratedPlan } from './ruleEngine.types';

// No numeric threshold is pinned anywhere in the spec corpus beyond "a
// TechSpec-defined threshold" (task_04 requirement); the clearest,
// unambiguous reading of "unusably small" is a day left with nothing to
// do at all, so that is what gates the 422 here.
const MIN_EXERCISES_PER_DAY = 1;

export function isPlanUsable(plan: GeneratedPlan): boolean {
  return (
    plan.days.length > 0 &&
    plan.days.every((day) => day.exercises.length >= MIN_EXERCISES_PER_DAY)
  );
}

export function toWorkoutInput(
  plan: GeneratedPlan,
  goal: FitnessGoal,
  explanation: string,
): WorkoutInput {
  return {
    goal,
    daysPerWeek: plan.days.length,
    explanation,
    days: plan.days.map((day) => ({
      dayOfWeek: day.dayOfWeek,
      exercises: day.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        sets: exercise.sets,
        reps: exercise.reps,
        order: exercise.order,
      })),
    })),
  };
}
