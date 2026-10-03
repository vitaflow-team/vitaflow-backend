import { BRT_OFFSET_HOURS } from './assessmentLimits.constants';

const HOUR_MS = 60 * 60 * 1000;
const NOON_HOURS = 12;

// Today's calendar date in Brasília time, as `YYYY-MM-DD`.
export function todayInBrt(now: Date = new Date()): string {
  return new Date(now.getTime() - BRT_OFFSET_HOURS * HOUR_MS)
    .toISOString()
    .slice(0, 10);
}

// The instant a date-only assessment takes in the student's evolution: that
// date at 12:00 Brasília time (15:00 UTC), so a calendar date never slides to
// a neighboring day in a chart, whatever the viewer's time zone.
export function assessedOnToInstant(assessedOn: Date): Date {
  return new Date(
    assessedOn.getTime() + (NOON_HOURS + BRT_OFFSET_HOURS) * HOUR_MS,
  );
}

// A well-formed calendar date (rejects `2026-13-40` and `2026-02-30`).
export function isRealCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function parseAssessedOn(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
