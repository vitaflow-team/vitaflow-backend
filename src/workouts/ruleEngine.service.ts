import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { Injectable } from '@nestjs/common';
import { Exercise, ExerciseStatus } from '@prisma/client';
import { EXPERIENCE_LEVEL_TO_DIFFICULTY } from './experienceLevel.constants';
import { MUSCLE_FOCUS_TO_CATALOG_VALUES } from './muscleFocus.constants';
import {
  CANDIDATE_FETCH_LIMIT,
  EXERCISES_PER_DAY,
  FOCUS_SLOTS_PER_DAY,
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
    // ADR-013: both biases below only reorder/subset `candidates` — they
    // never shrink the pool `perDayCount`/`scaled` are computed from, so
    // neither can cause a 422 on its own (UT-034).
    const ordered = this.applyExperienceBias(candidates, input.experienceLevel);
    const focusCandidates = this.selectFocusCandidates(
      ordered,
      input.muscleFocus,
    );
    const { sets, reps } = SETS_REPS_BY_GOAL[goal];
    const perDayCount = Math.min(EXERCISES_PER_DAY, ordered.length);
    const scaled = perDayCount < EXERCISES_PER_DAY;

    const days: GeneratedWorkoutDay[] = [];
    for (let dayIndex = 0; dayIndex < daysPerWeek; dayIndex++) {
      days.push({
        dayOfWeek: dayIndex + 1,
        exercises: this.pickDayExercises(
          ordered,
          focusCandidates,
          dayIndex,
          perDayCount,
          { sets, reps },
        ),
      });
    }

    return { days, scaled };
  }

  // Soft preference (ADR-013): moves candidates whose difficulty maps to the
  // user's experience level to the front, without excluding anything — a
  // stable partition, so behavior is identical to today's plain rotation
  // when `experienceLevel` is absent.
  private applyExperienceBias(
    candidates: Exercise[],
    experienceLevel: RuleEngineInput['experienceLevel'],
  ): Exercise[] {
    if (!experienceLevel) return candidates;
    const matching = EXPERIENCE_LEVEL_TO_DIFFICULTY[experienceLevel];
    const preferred: Exercise[] = [];
    const rest: Exercise[] = [];
    for (const candidate of candidates) {
      if (candidate.difficulty && matching.includes(candidate.difficulty)) {
        preferred.push(candidate);
      } else {
        rest.push(candidate);
      }
    }
    return [...preferred, ...rest];
  }

  // The subset of `candidates` matching the chosen muscle focus, used by
  // `pickDayExercises` to reserve slots — empty (not a filter) when no
  // focus was given, so the day's pick falls through to the normal rotation.
  private selectFocusCandidates(
    candidates: Exercise[],
    muscleFocus: RuleEngineInput['muscleFocus'],
  ): Exercise[] {
    if (!muscleFocus) return [];
    const matching = MUSCLE_FOCUS_TO_CATALOG_VALUES[muscleFocus];
    return candidates.filter((candidate) =>
      matching.includes(candidate.muscleGroup),
    );
  }

  private pickDayExercises(
    candidates: Exercise[],
    focusCandidates: Exercise[],
    dayIndex: number,
    perDayCount: number,
    reps: { sets: number; reps: number },
  ): GeneratedWorkoutDay['exercises'] {
    const exercises: GeneratedWorkoutDay['exercises'] = [];
    const used = new Set<string>();
    const tryAdd = (candidate: Exercise): void => {
      if (used.has(candidate.id)) return;
      used.add(candidate.id);
      exercises.push({
        exerciseId: candidate.id,
        sets: reps.sets,
        reps: reps.reps,
        order: exercises.length + 1,
      });
    };

    // Reserve up to FOCUS_SLOTS_PER_DAY slots for the muscle-focus pool
    // first (ADR-013) — never more than what's actually available or than
    // the day's total count, so this can only add emphasis, never shrink
    // the day.
    const focusSlots = Math.min(
      FOCUS_SLOTS_PER_DAY,
      focusCandidates.length,
      perDayCount,
    );
    for (let i = 0; i < focusSlots; i++) {
      tryAdd(
        focusCandidates[(dayIndex * focusSlots + i) % focusCandidates.length],
      );
    }

    // Fills the remaining slots from the general rotation (identical
    // formula to the pre-ADR-013 implementation), skipping anything the
    // focus reservation above already used for this day.
    for (
      let offset = 0;
      exercises.length < perDayCount && offset < candidates.length;
      offset++
    ) {
      tryAdd(candidates[(dayIndex * perDayCount + offset) % candidates.length]);
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
