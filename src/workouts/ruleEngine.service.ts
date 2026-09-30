import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { Injectable } from '@nestjs/common';
import { Exercise, ExerciseStatus } from '@prisma/client';
import {
  CANDIDATE_FETCH_LIMIT,
  EXERCISES_PER_DAY,
  SETS_REPS_BY_GOAL,
} from './ruleEngine.constants';
import {
  GeneratedPlan,
  GeneratedWorkoutDay,
  RuleEngineInput,
} from './ruleEngine.types';

// Deterministic exercise selection — no LLM call, ever (ADR-001). The LLM
// layer (LlmExplanationService) only narrates what this service decides.
@Injectable()
export class RuleEngineService {
  constructor(private readonly exercises: ExercisesRepository) {}

  async select(input: RuleEngineInput): Promise<GeneratedPlan> {
    const { goal, daysPerWeek, equipment, restrictions } = input;

    // daysPerWeek <= 0 is rejected upstream at the WorkoutsService/DTO layer
    // (UT-010); the rule engine itself just returns an empty plan rather
    // than throwing, since it has no validation responsibility here.
    if (daysPerWeek <= 0) {
      return { days: [], scaled: false };
    }

    const candidates = await this.findCandidates(equipment, restrictions);
    const { sets, reps } = SETS_REPS_BY_GOAL[goal];
    const perDayCount = Math.min(EXERCISES_PER_DAY, candidates.length);
    const scaled = perDayCount < EXERCISES_PER_DAY;

    const days: GeneratedWorkoutDay[] = [];
    for (let dayIndex = 0; dayIndex < daysPerWeek; dayIndex++) {
      days.push({
        dayOfWeek: dayIndex + 1,
        exercises: this.pickDayExercises(candidates, dayIndex, perDayCount, {
          sets,
          reps,
        }),
      });
    }

    return { days, scaled };
  }

  private pickDayExercises(
    candidates: Exercise[],
    dayIndex: number,
    perDayCount: number,
    reps: { sets: number; reps: number },
  ): GeneratedWorkoutDay['exercises'] {
    const exercises: GeneratedWorkoutDay['exercises'] = [];
    for (let slot = 0; slot < perDayCount; slot++) {
      // Rotates the starting offset per day so different days draw from
      // different parts of the candidate list when there are enough of
      // them, instead of every day being an identical list.
      const candidate =
        candidates[(dayIndex * perDayCount + slot) % candidates.length];
      exercises.push({
        exerciseId: candidate.id,
        sets: reps.sets,
        reps: reps.reps,
        order: slot + 1,
      });
    }
    return exercises;
  }

  private async findCandidates(
    equipment: RuleEngineInput['equipment'],
    restrictions: RuleEngineInput['restrictions'],
  ): Promise<Exercise[]> {
    const matches = await this.exercises.findMany({
      status: ExerciseStatus.APPROVED,
      equipment,
      skip: 0,
      take: CANDIDATE_FETCH_LIMIT,
    });

    if (restrictions.length === 0) return matches;

    return matches.filter(
      (exercise) =>
        !exercise.contraindications.some((contraindication) =>
          restrictions.includes(contraindication),
        ),
    );
  }
}
