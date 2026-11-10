import { brtDateKey } from '@/utils/brtDate';

const DAY_MS = 24 * 60 * 60 * 1000;
const SMOOTHING_WINDOW_DAYS = 7;

export interface WeightPoint {
  recordedAt: Date;
  weightKg: number;
}

export interface TrendPoint {
  recordedAt: string;
  weightKg: number;
  smoothedWeightKg: number | null;
}

export interface PeriodComparisonMetric {
  metric: 'weight' | 'diaryLoggedDays';
  current: number | null;
  previous: number | null;
  deltaPercent: number | null;
  noActivityThisPeriod?: boolean;
}

export interface StreakSummary {
  currentDays: number;
  personalBestDays: number;
}

export interface AdherenceSummary {
  workoutPercent: null;
  workoutTrackingUnavailable: true;
  hasWorkoutPlan: boolean;
  diaryPercent: number;
}

export interface CorrelationPoint {
  date: string;
  weight: number | null;
  diaryAdherencePercent: number | null;
}

/** BRT midnight on day 1 of the calendar month before `now`'s (mirrors academia/engajamento's resolvePreviousMonthStart). */
export function resolvePreviousMonthStart(now: Date): Date {
  const [year, month] = brtDateKey(now).split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return new Date(Date.UTC(prevYear, prevMonth - 1, 1, 3, 0, 0));
}

function monthBucketsOf(now: Date) {
  const [year, month] = brtDateKey(now).split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const bucketOf = (date: Date): 'current' | 'previous' | null => {
    const [y, m] = brtDateKey(date).split('-').map(Number);
    if (y === year && m === month) return 'current';
    if (y === prevYear && m === prevMonth) return 'previous';
    return null;
  };
  return bucketOf;
}

/** One value per BRT calendar day (most recent entry of that day), smoothed
 * over a trailing 7-distinct-day window; null until 7 distinct days are
 * available in that window — no interpolation across gaps (UT-001/UT-003). */
export function computeSmoothedTrend(points: WeightPoint[]): TrendPoint[] {
  const byDay = new Map<string, WeightPoint>();
  for (const point of points) {
    const key = brtDateKey(point.recordedAt);
    const existing = byDay.get(key);
    if (
      !existing ||
      point.recordedAt.getTime() >= existing.recordedAt.getTime()
    ) {
      byDay.set(key, point);
    }
  }
  const dayEntries = [...byDay.values()].sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
  );

  return dayEntries.map((entry, index) => {
    const windowStart =
      entry.recordedAt.getTime() - (SMOOTHING_WINDOW_DAYS - 1) * DAY_MS;
    const windowValues = dayEntries
      .slice(0, index + 1)
      .filter((candidate) => candidate.recordedAt.getTime() >= windowStart);
    const smoothedWeightKg =
      windowValues.length >= SMOOTHING_WINDOW_DAYS
        ? Math.round(
            (windowValues.reduce((sum, p) => sum + p.weightKg, 0) /
              windowValues.length) *
              10,
          ) / 10
        : null;
    return {
      recordedAt: entry.recordedAt.toISOString(),
      weightKg: entry.weightKg,
      smoothedWeightKg,
    };
  });
}

function percentDelta(
  current: number | null,
  previous: number | null,
): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Weight (latest entry per calendar month) and diary-logged-day-count,
 * current vs. previous BRT calendar month. "Workout frequency" is omitted
 * entirely, per ADR-010 — no completion signal exists to report it from. */
export function computePeriodComparison(
  weightPoints: WeightPoint[],
  diaryLoggedDates: Date[],
  now: Date,
): PeriodComparisonMetric[] {
  const bucketOf = monthBucketsOf(now);

  let currentWeight: WeightPoint | null = null;
  let previousWeight: WeightPoint | null = null;
  for (const point of weightPoints) {
    const bucket = bucketOf(point.recordedAt);
    if (
      bucket === 'current' &&
      (!currentWeight || point.recordedAt > currentWeight.recordedAt)
    ) {
      currentWeight = point;
    }
    if (
      bucket === 'previous' &&
      (!previousWeight || point.recordedAt > previousWeight.recordedAt)
    ) {
      previousWeight = point;
    }
  }

  const currentDiaryDays = new Set<string>();
  const previousDiaryDays = new Set<string>();
  for (const date of diaryLoggedDates) {
    const bucket = bucketOf(date);
    if (bucket === 'current') currentDiaryDays.add(brtDateKey(date));
    if (bucket === 'previous') previousDiaryDays.add(brtDateKey(date));
  }
  const currentDiaryCount = currentDiaryDays.size;
  const previousDiaryCount = previousDiaryDays.size;

  return [
    {
      metric: 'weight',
      current: currentWeight?.weightKg ?? null,
      previous: previousWeight?.weightKg ?? null,
      deltaPercent: percentDelta(
        currentWeight?.weightKg ?? null,
        previousWeight?.weightKg ?? null,
      ),
    },
    {
      metric: 'diaryLoggedDays',
      current: currentDiaryCount,
      previous: previousDiaryCount,
      deltaPercent: percentDelta(currentDiaryCount, previousDiaryCount),
      ...(currentDiaryCount === 0 && previousDiaryCount > 0
        ? { noActivityThisPeriod: true }
        : {}),
    },
  ];
}

function isNextBrtDay(previousKey: string, key: string): boolean {
  const previous = new Date(`${previousKey}T00:00:00.000Z`);
  const current = new Date(`${key}T00:00:00.000Z`);
  return current.getTime() - previous.getTime() === DAY_MS;
}

/** Consecutive-day diary-logging streak (Meal entries only, per ADR-010 —
 * no workout-completion signal exists to OR against), from each entry's
 * logical date, not submission order (UT-011). Not built on
 * `food-diary/streak.util.ts`'s `calculateStreak`: that helper buckets by
 * plain UTC calendar day, while every other widget in this dashboard
 * (adherence, correlation, task_01's heatmap/month-boundary) buckets by BRT
 * day — reusing it here would make a meal logged shortly after midnight BRT
 * count toward a different day in the streak than in `diaryPercent`. */
export function computeStreak(
  diaryLoggedDates: Date[],
  now: Date,
): StreakSummary {
  const dayKeys = new Set(diaryLoggedDates.map((date) => brtDateKey(date)));

  let currentDays = 0;
  let cursor = now;
  while (dayKeys.has(brtDateKey(cursor))) {
    currentDays += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }

  const sortedKeys = [...dayKeys].sort();
  let personalBestDays = 0;
  let run = 0;
  let previousKey: string | null = null;
  for (const key of sortedKeys) {
    run = previousKey && isNextBrtDay(previousKey, key) ? run + 1 : 1;
    personalBestDays = Math.max(personalBestDays, run);
    previousKey = key;
  }

  return {
    currentDays,
    personalBestDays: Math.max(personalBestDays, currentDays),
  };
}

/** Days with >=1 logged meal, divided by days elapsed in the window. Always
 * a real number (0 when never logged) — never null, unlike the permanently
 * unavailable workout dimension (ADR-010). */
export function computeDiaryAdherence(
  diaryLoggedDates: Date[],
  since: Date,
  now: Date,
): number {
  const totalDays = Math.max(
    1,
    Math.ceil((now.getTime() - since.getTime()) / DAY_MS),
  );
  const loggedDays = new Set(diaryLoggedDates.map((date) => brtDateKey(date)))
    .size;
  return Math.round((loggedDays / totalDays) * 1000) / 10;
}

export function computeAdherence(
  diaryLoggedDates: Date[],
  since: Date,
  now: Date,
  hasWorkoutPlan: boolean,
): AdherenceSummary {
  return {
    workoutPercent: null,
    workoutTrackingUnavailable: true,
    hasWorkoutPlan,
    diaryPercent: computeDiaryAdherence(diaryLoggedDates, since, now),
  };
}

/** One point per distinct date where weight and/or a diary entry exists.
 * `diaryAdherencePercent` is 100 when that day has a diary entry, else null
 * — there is no "0%" per-day state, only "logged" or "no signal" (UT-017). */
export function computeCorrelation(
  weightPoints: WeightPoint[],
  diaryLoggedDates: Date[],
): CorrelationPoint[] {
  const weightByDay = new Map<string, number>();
  for (const point of weightPoints) {
    weightByDay.set(brtDateKey(point.recordedAt), point.weightKg);
  }
  const diaryDaySet = new Set(diaryLoggedDates.map((date) => brtDateKey(date)));
  const allDays = new Set([...weightByDay.keys(), ...diaryDaySet]);

  return [...allDays].sort().map((day) => ({
    date: day,
    weight: weightByDay.get(day) ?? null,
    diaryAdherencePercent: diaryDaySet.has(day) ? 100 : null,
  }));
}
