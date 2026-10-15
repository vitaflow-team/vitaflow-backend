import {
  FIXED_DAY_MINUTES,
  FIXED_DURATION_MAX_MINUTES,
  FIXED_DURATION_MIN_MINUTES,
  FIXED_START_MAX_MINUTE,
  FIXED_START_STEP_MINUTES,
  FIXED_WEEKDAY_MAX,
  FIXED_WEEKDAY_MIN,
} from '@/scheduling/fixed-times/fixedTime.constants';
import { isStep, isWhole } from '@/scheduling/fixed-times/fixedTime.util';

export interface TurmaScheduleRule {
  weekday: number;
  startMinute: number;
  durationMinutes: number;
}

export interface TurmaScheduleProblem {
  field: keyof TurmaScheduleRule | 'capacity';
}

export function validateTurmaSchedule(
  rule: TurmaScheduleRule,
): TurmaScheduleProblem[] {
  const problems: TurmaScheduleProblem[] = [];

  if (!isWhole(rule.weekday, FIXED_WEEKDAY_MIN, FIXED_WEEKDAY_MAX)) {
    problems.push({ field: 'weekday' });
  }
  if (
    !isStep(
      rule.startMinute,
      0,
      FIXED_START_MAX_MINUTE,
      FIXED_START_STEP_MINUTES,
    )
  ) {
    problems.push({ field: 'startMinute' });
  }
  if (
    !isStep(
      rule.durationMinutes,
      FIXED_DURATION_MIN_MINUTES,
      FIXED_DURATION_MAX_MINUTES,
      FIXED_START_STEP_MINUTES,
    )
  ) {
    problems.push({ field: 'durationMinutes' });
  }
  if (
    Number.isInteger(rule.startMinute) &&
    Number.isInteger(rule.durationMinutes) &&
    rule.startMinute + rule.durationMinutes > FIXED_DAY_MINUTES
  ) {
    problems.push({ field: 'durationMinutes' });
  }
  return problems;
}

export function validateCapacity(capacity: number): boolean {
  return Number.isInteger(capacity) && capacity > 0;
}

export function isScheduleShapeChange(
  patch: Partial<TurmaScheduleRule>,
): boolean {
  return (
    patch.weekday !== undefined ||
    patch.startMinute !== undefined ||
    patch.durationMinutes !== undefined
  );
}
