import { SessionType } from '@prisma/client';
import {
  FIXED_DAY_MINUTES,
  FIXED_DURATION_MAX_MINUTES,
  FIXED_DURATION_MIN_MINUTES,
  FIXED_ONLINE_LINK_MAX,
  FIXED_START_MAX_MINUTE,
  FIXED_START_STEP_MINUTES,
  FIXED_WEEKDAY_MAX,
  FIXED_WEEKDAY_MIN,
  FIXED_WORKOUT_LETTERS,
} from './fixedTime.constants';

// Brazil has no DST since 2019 (TechSpec Key Decisions): a fixed offset.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;

export interface TimeRange {
  startAt: Date;
  endAt: Date;
}

export interface FixedTimeRule {
  weekday: number;
  startMinute: number;
  durationMinutes: number;
  type: SessionType;
  onlineLink: string | null;
  workoutLetter: string | null;
}

export interface RuleProblem {
  field: keyof FixedTimeRule;
  code: 'invalid' | 'link_not_allowed';
}

// A row that occupies the educator's time: a fixed session or a booked slot.
export interface OccupancyRow extends TimeRange {
  status: 'SCHEDULED' | 'CANCELED' | 'BOOKED';
  fixedTimeId: string | null;
  studentName: string;
}

export interface Conflict extends TimeRange {
  studentName: string;
}

/** The Brasília calendar date of an instant, as `YYYY-MM-DD`. */
export function brtDateKey(instant: Date): string {
  const shifted = new Date(instant.getTime() - BRT_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/** The ISO weekday (1 Mon .. 7 Sun) of a Brasília calendar date. */
function isoWeekdayOfKey(dateKey: string): number {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The occurrences of a rule that start from `from` (inclusive) to `until`
 * (inclusive), in UTC. The start minute is Brasília time, so a Sunday 23:00
 * rule is `02:00Z` of the following UTC day and keeps the Sunday date.
 * Dates in `skipDates` (Brasília `YYYY-MM-DD`) are left out.
 */
export function occurrencesBetween(
  rule: Pick<FixedTimeRule, 'weekday' | 'startMinute' | 'durationMinutes'>,
  from: Date,
  until: Date,
  skipDates: Set<string> = new Set(),
): TimeRange[] {
  const ranges: TimeRange[] = [];
  const lastKey = brtDateKey(until);
  // One day before the first Brasília date covers an occurrence that starts
  // late on the previous date but in UTC still falls after `from`.
  let dateKey = addDays(brtDateKey(from), -1);

  while (dateKey <= lastKey) {
    if (isoWeekdayOfKey(dateKey) === rule.weekday && !skipDates.has(dateKey)) {
      const midnightUtc = new Date(`${dateKey}T00:00:00Z`).getTime();
      const startAt = new Date(
        midnightUtc + rule.startMinute * MINUTE_MS + BRT_OFFSET_MS,
      );
      if (startAt >= from && startAt <= until) {
        ranges.push({
          startAt,
          endAt: new Date(startAt.getTime() + rule.durationMinutes * MINUTE_MS),
        });
      }
    }
    dateKey = addDays(dateKey, 1);
  }
  return ranges;
}

/** Half-open comparison: a range that ends exactly where another starts does not overlap. */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

/**
 * The earliest occupancy that overlaps any of the ranges. Canceled rows never
 * conflict, and rows of `ignoreFixedTimeId` (the time being edited) are not
 * a conflict with themselves.
 */
export function findEarliestConflict(
  ranges: TimeRange[],
  occupancy: OccupancyRow[],
  ignoreFixedTimeId?: string,
): Conflict | null {
  const candidates = occupancy
    .filter((row) => row.status !== 'CANCELED')
    .filter(
      (row) => !(ignoreFixedTimeId && row.fixedTimeId === ignoreFixedTimeId),
    )
    .filter((row) => ranges.some((range) => rangesOverlap(range, row)))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const first = candidates[0];
  return first
    ? {
        startAt: first.startAt,
        endAt: first.endAt,
        studentName: first.studentName,
      }
    : null;
}

/** The rule's problems, one per field; an empty list means the rule is valid. */
export function validateRule(rule: FixedTimeRule): RuleProblem[] {
  const problems: RuleProblem[] = [];
  const invalid = (field: keyof FixedTimeRule): void => {
    problems.push({ field, code: 'invalid' });
  };

  if (!isWhole(rule.weekday, FIXED_WEEKDAY_MIN, FIXED_WEEKDAY_MAX)) {
    invalid('weekday');
  }
  if (
    !isStep(
      rule.startMinute,
      0,
      FIXED_START_MAX_MINUTE,
      FIXED_START_STEP_MINUTES,
    )
  ) {
    invalid('startMinute');
  }
  if (
    !isStep(
      rule.durationMinutes,
      FIXED_DURATION_MIN_MINUTES,
      FIXED_DURATION_MAX_MINUTES,
      FIXED_START_STEP_MINUTES,
    )
  ) {
    invalid('durationMinutes');
  }
  if (
    Number.isInteger(rule.startMinute) &&
    Number.isInteger(rule.durationMinutes) &&
    rule.startMinute + rule.durationMinutes > FIXED_DAY_MINUTES
  ) {
    invalid('durationMinutes');
  }
  if (rule.workoutLetter !== null && !isLetter(rule.workoutLetter)) {
    invalid('workoutLetter');
  }
  validateLink(rule, problems);
  return problems;
}

function validateLink(rule: FixedTimeRule, problems: RuleProblem[]): void {
  if (rule.onlineLink === null) return;
  if (rule.type === SessionType.PRESENCIAL) {
    problems.push({ field: 'onlineLink', code: 'link_not_allowed' });
    return;
  }
  if (!isHttpLink(rule.onlineLink)) {
    problems.push({ field: 'onlineLink', code: 'invalid' });
  }
}

/** Only http(s), no spaces or markup, at most 500 characters. */
export function isHttpLink(value: string): boolean {
  if (value.length > FIXED_ONLINE_LINK_MAX) return false;
  if (/[\s<>"]/.test(value)) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function isLetter(value: string): boolean {
  return value.length === 1 && FIXED_WORKOUT_LETTERS.includes(value);
}

/** The position of a session letter (A = 0). */
export function letterIndex(letter: string): number {
  return FIXED_WORKOUT_LETTERS.indexOf(letter);
}

export interface LetterResolution {
  sessionName: string | null;
  missing: boolean;
}

/**
 * The session a letter names in the student's active workout (by position).
 * No letter or no active workout is not a missing link; a letter beyond the
 * sessions is missing.
 */
export function resolveLetter(
  letter: string | null,
  activeSessionNames: string[] | null,
): LetterResolution {
  if (letter === null || activeSessionNames === null) {
    return { sessionName: null, missing: false };
  }
  const name = activeSessionNames[letterIndex(letter)];
  return name === undefined
    ? { sessionName: null, missing: true }
    : { sessionName: name, missing: false };
}

export interface TodayCandidate extends TimeRange {
  workoutLetter: string | null;
}

/**
 * Today's session of a student: the earliest scheduled session of today's
 * Brasília date that has not ended and whose letter resolves to a session of
 * the active workout. Sessions without a resolving letter are skipped.
 */
export function todaySession<T extends TodayCandidate>(
  candidates: T[],
  now: Date,
  resolvesLetter: (letter: string) => boolean,
): T | null {
  const today = brtDateKey(now);
  const found = candidates
    .filter((candidate) => brtDateKey(candidate.startAt) === today)
    .filter((candidate) => candidate.endAt > now)
    .filter(
      (candidate) =>
        candidate.workoutLetter !== null &&
        resolvesLetter(candidate.workoutLetter),
    )
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return found[0] ?? null;
}

/** Key of the per-educator advisory lock; `bookSlot` takes the same key. */
export function educatorScheduleLockKey(educatorId: string): string {
  return `educator-schedule:${educatorId}`;
}

export function isWhole(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function isStep(
  value: number,
  min: number,
  max: number,
  step: number,
): boolean {
  return isWhole(value, min, max) && value % step === 0;
}
