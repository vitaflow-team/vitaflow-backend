import { calculateStreak } from './streak.util';

const TODAY = new Date('2026-09-30T00:00:00.000Z');

function daysAgo(n: number): Date {
  const date = new Date(TODAY);
  date.setUTCDate(date.getUTCDate() - n);
  return date;
}

describe('calculateStreak', () => {
  it('UT-024 counts 5 consecutive days including today as 5', () => {
    const dates = [daysAgo(4), daysAgo(3), daysAgo(2), daysAgo(1), daysAgo(0)];

    expect(calculateStreak(dates, TODAY)).toBe(5);
  });

  it('UT-025 resets to 1 when there is a gap before today', () => {
    const dates = [daysAgo(3), daysAgo(0)];

    expect(calculateStreak(dates, TODAY)).toBe(1);
  });

  it('UT-026 a backfilled entry inside a broken gap does not repair the streak', () => {
    // Logged 5 days ago and today (streak would be 1 from today), then a
    // backfill lands on day -3 — inside the gap, but not adjacent to the
    // unbroken run ending today (day -1 is still missing).
    const dates = [daysAgo(5), daysAgo(3), daysAgo(0)];

    expect(calculateStreak(dates, TODAY)).toBe(1);
  });

  it('returns 0 when nothing was logged today', () => {
    const dates = [daysAgo(1), daysAgo(2)];

    expect(calculateStreak(dates, TODAY)).toBe(0);
  });

  it('counts duplicate same-day entries only once', () => {
    const dates = [daysAgo(0), daysAgo(0), daysAgo(1)];

    expect(calculateStreak(dates, TODAY)).toBe(2);
  });
});
