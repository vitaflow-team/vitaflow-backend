import { FitnessGoal } from '@prisma/client';

// Target exercises per training day; scaled down when the filtered catalog
// can't supply this many (see RuleEngineService.select).
export const EXERCISES_PER_DAY = 5;

// Standard fitness-programming conventions: higher-rep ranges for weight
// loss/conditioning, moderate-rep, higher-volume for muscle gain, a
// balanced default for maintenance.
export const SETS_REPS_BY_GOAL: Record<
  FitnessGoal,
  { sets: number; reps: number }
> = {
  WEIGHT_LOSS: { sets: 3, reps: 15 },
  CONDITIONING: { sets: 3, reps: 15 },
  MUSCLE_GAIN: { sets: 4, reps: 8 },
  MAINTENANCE: { sets: 3, reps: 12 },
};

// Large enough to cover the full catalog in one query; the rule engine
// needs every matching candidate, not a paginated page of them.
export const CANDIDATE_FETCH_LIMIT = 1000;
