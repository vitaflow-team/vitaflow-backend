import { AvailabilityWindow } from '@prisma/client';
import {
  BRT_OFFSET_MINUTES,
  DAY_MS,
  MINUTE_MS,
  ROLLING_WEEKS,
} from './scheduling.constants';

export interface GeneratedSlot {
  professionalId: string;
  availabilityWindowId: string;
  startAt: Date;
  endAt: Date;
}

// Prisma's `getUTCDay()` is 0 (Sun)..6 (Sat); the window's `dayOfWeek` is
// ISO 8601, 1 (Mon)..7 (Sun).
function isoDayOfWeek(utcMidnight: Date): number {
  const jsDay = utcMidnight.getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

// The UTC-midnight instant of "today" as a BRT calendar date — used only to
// pick which calendar days to iterate, never as a time-of-day value itself.
function brtCalendarDateOf(now: Date): Date {
  const brtInstant = new Date(now.getTime() - BRT_OFFSET_MINUTES * MINUTE_MS);
  return new Date(
    Date.UTC(
      brtInstant.getUTCFullYear(),
      brtInstant.getUTCMonth(),
      brtInstant.getUTCDate(),
    ),
  );
}

// BRT midnight of `utcMidnightOfBrtDate` is UTC 03:00 of that same date, so
// a BRT wall-clock minute maps to UTC by adding the fixed offset.
function brtMinutesToUtc(
  utcMidnightOfBrtDate: Date,
  minutesFromMidnightBrt: number,
): Date {
  return new Date(
    utcMidnightOfBrtDate.getTime() +
      (minutesFromMidnightBrt + BRT_OFFSET_MINUTES) * MINUTE_MS,
  );
}

// Expands one recurring weekly window into individual, non-overlapping
// bookable instances for the rolling window ahead of `now` (US-001.AC-1,
// AC-2). Slots already in the past are skipped, never generated.
export function generateSlotsForWindow(
  window: AvailabilityWindow,
  now: Date,
): GeneratedSlot[] {
  const slots: GeneratedSlot[] = [];
  const startDay = brtCalendarDateOf(now);
  const totalDays = ROLLING_WEEKS * 7;
  const durationMs = window.sessionDurationMinutes * MINUTE_MS;

  for (let offset = 0; offset < totalDays; offset++) {
    const cursor = new Date(startDay.getTime() + offset * DAY_MS);
    if (isoDayOfWeek(cursor) !== window.dayOfWeek) continue;

    const dayStartUtc = brtMinutesToUtc(cursor, window.startMinute);
    const dayEndUtc = brtMinutesToUtc(cursor, window.endMinute);

    for (
      let slotStart = dayStartUtc;
      new Date(slotStart.getTime() + durationMs) <= dayEndUtc;
      slotStart = new Date(slotStart.getTime() + durationMs)
    ) {
      if (slotStart < now) continue;
      slots.push({
        professionalId: window.professionalId,
        availabilityWindowId: window.id,
        startAt: slotStart,
        endAt: new Date(slotStart.getTime() + durationMs),
      });
    }
  }

  return slots;
}
