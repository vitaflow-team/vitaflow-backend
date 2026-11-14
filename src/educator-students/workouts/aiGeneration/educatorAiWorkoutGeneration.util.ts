import { EducatorExerciseSource, Exercise } from '@prisma/client';
import { GeneratedPlan } from '@/workouts/ruleEngine.types';
import { SessionInput, WorkoutTreeInput } from '../workoutTree.util';

const SESSION_NAME_PREFIX = 'Dia';

/**
 * Maps the rule engine's `GeneratedPlan` (ai-workout-prescription-b2b
 * ADR-001: selection is always the rule engine's, never the LLM's) into the
 * `WorkoutTreeInput` shape `EducatorWorkoutsRepository` already writes for
 * manual edits. The rule engine's `sets`/`reps` are numbers; the B2B tree
 * needs `reps` as a string and has no `load` concept the rule engine
 * produces, so `load` is always `null` here.
 */
export function toEducatorWorkoutInput(
  title: string,
  weeklyFrequency: number,
  plan: GeneratedPlan,
  exercisesById: Map<string, Exercise>,
): WorkoutTreeInput {
  return {
    title,
    weeklyFrequency,
    sessions: plan.days.map(
      (day): SessionInput => ({
        name: `${SESSION_NAME_PREFIX} ${day.dayOfWeek}`,
        exercises: day.exercises.map((exercise) => {
          const libraryExercise = exercisesById.get(exercise.exerciseId);
          if (!libraryExercise) {
            // The rule engine only ever returns ids it fetched from the same
            // library this util is given — a missing entry means the caller
            // built `exercisesById` incorrectly, an internal-invariant bug,
            // not a user-facing failure.
            throw new Error(
              `toEducatorWorkoutInput: exercise ${exercise.exerciseId} missing from exercisesById`,
            );
          }
          return {
            source: EducatorExerciseSource.LIBRARY,
            exerciseId: libraryExercise.id,
            name: libraryExercise.name,
            muscleGroup: libraryExercise.muscleGroup,
            equipment: libraryExercise.equipment,
            sets: exercise.sets,
            reps: String(exercise.reps),
            load: null,
            videoUrl: null,
          };
        }),
      }),
    ),
  };
}
