import {
  computeAdherence,
  computeCorrelation,
  computePeriodComparison,
  computeSmoothedTrend,
  computeStreak,
  resolvePreviousMonthStart,
  type WeightPoint,
} from './progressDashboardAggregation.util';

const NOW = new Date('2026-11-15T15:00:00Z'); // Sun 12:00 BRT
const DAY_MS = 24 * 60 * 60 * 1000;

function weightPoint(recordedAt: string, weightKg: number): WeightPoint {
  return { recordedAt: new Date(recordedAt), weightKg };
}

function datesOnDays(brtDates: string[]): Date[] {
  // Noon BRT (15:00Z) on each given date, well clear of any day boundary.
  return brtDates.map((date) => new Date(`${date}T15:00:00Z`));
}

describe('computeSmoothedTrend', () => {
  it('UT-001 computes a 7-day moving average from day 7 onward, each equal to the mean of the trailing 7 raw values', () => {
    const points = Array.from({ length: 10 }, (_, i) =>
      weightPoint(
        new Date(NOW.getTime() - (9 - i) * DAY_MS).toISOString(),
        70 + i,
      ),
    );

    const trend = computeSmoothedTrend(points);

    expect(trend).toHaveLength(10);
    expect(trend.slice(0, 6).every((p) => p.smoothedWeightKg === null)).toBe(
      true,
    );
    // Day 7 (index 6): mean of raw values 70..76 = 73
    expect(trend[6].smoothedWeightKg).toBe(73);
    // Day 10 (index 9): mean of raw values 73..79 = 76
    expect(trend[9].smoothedWeightKg).toBe(76);
  });

  it('UT-002 returns the raw point with smoothedWeightKg null for exactly 1 entry, no exception', () => {
    const trend = computeSmoothedTrend([weightPoint(NOW.toISOString(), 70)]);

    expect(trend).toEqual([
      { recordedAt: NOW.toISOString(), weightKg: 70, smoothedWeightKg: null },
    ]);
  });

  it('UT-003 never interpolates across a 60-day gap — the second entry has no 7-day history yet', () => {
    const first = weightPoint('2026-09-01T12:00:00Z', 80);
    const second = weightPoint('2026-10-31T12:00:00Z', 75); // 60 days later

    const trend = computeSmoothedTrend([first, second]);

    expect(trend[1].smoothedWeightKg).toBeNull();
  });

  it('UT-004 uses the most recent of two same-day entries, not a sum or duplicate count', () => {
    const morning = weightPoint('2026-11-15T09:00:00Z', 70);
    const evening = weightPoint('2026-11-15T20:00:00Z', 71);

    const trend = computeSmoothedTrend([morning, evening]);

    expect(trend).toHaveLength(1);
    expect(trend[0].weightKg).toBe(71);
  });
});

describe('computePeriodComparison', () => {
  it('UT-005 returns weight and diaryLoggedDays metrics for current vs. previous calendar month ("workout frequency" omitted per ADR-010)', () => {
    const weightPoints = [
      weightPoint('2026-11-10T12:00:00Z', 70), // current (Nov)
      weightPoint('2026-10-15T12:00:00Z', 72), // previous (Oct)
    ];
    const diaryDates = datesOnDays(['2026-11-01', '2026-11-02', '2026-10-01']);

    const metrics = computePeriodComparison(weightPoints, diaryDates, NOW);

    expect(metrics.map((m) => m.metric)).toEqual(['weight', 'diaryLoggedDays']);
    expect(metrics).not.toContainEqual(
      expect.objectContaining({ metric: 'workoutFrequency' }),
    );
    const weight = metrics.find((m) => m.metric === 'weight')!;
    expect(weight.current).toBe(70);
    expect(weight.previous).toBe(72);
    const diary = metrics.find((m) => m.metric === 'diaryLoggedDays')!;
    expect(diary.current).toBe(2);
    expect(diary.previous).toBe(1);
    expect(diary.deltaPercent).toBe(100);
  });

  it('UT-006 returns deltaPercent null (not Infinity) with previous null when the previous period has zero weight data', () => {
    const weightPoints = [weightPoint('2026-11-10T12:00:00Z', 70)];

    const [weight] = computePeriodComparison(weightPoints, [], NOW);

    expect(weight.previous).toBeNull();
    expect(weight.deltaPercent).toBeNull();
  });

  it('UT-007 returns current 0 with noActivityThisPeriod true when the current period has zero diary entries but the previous one has data', () => {
    const diaryDates = datesOnDays(['2026-10-15']);

    const [, diary] = computePeriodComparison([], diaryDates, NOW);

    expect(diary.current).toBe(0);
    expect(diary.noActivityThisPeriod).toBe(true);
  });
});

describe('computeStreak', () => {
  it('UT-008 returns currentDays 5 for a diary entry on each of the last 5 consecutive days', () => {
    const diaryDates = datesOnDays([
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ]);

    expect(computeStreak(diaryDates, NOW).currentDays).toBe(5);
  });

  it('UT-009 resets to 1 across a one-day gap, not 6', () => {
    const diaryDates = datesOnDays([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      // gap on 2026-11-14
      '2026-11-15',
    ]);

    expect(computeStreak(diaryDates, NOW).currentDays).toBe(1);
  });

  it('UT-010 returns currentDays 1 and personalBestDays 1 for a single entry logged today with no history', () => {
    const result = computeStreak(datesOnDays(['2026-11-15']), NOW);

    expect(result).toEqual({ currentDays: 1, personalBestDays: 1 });
  });

  it('UT-011 recalculates from the entry logical date, not submission order — a backfilled "yesterday" entry still extends the streak', () => {
    // Both entries are logged *today*, but one's logical date is yesterday.
    const diaryDates = [
      new Date('2026-11-14T15:00:00Z'), // logical date: yesterday
      new Date('2026-11-15T15:00:00Z'), // logical date: today
    ];

    expect(computeStreak(diaryDates, NOW).currentDays).toBe(2);
  });
});

describe('computeAdherence', () => {
  it('UT-012 returns workoutPercent null / workoutTrackingUnavailable true even when a workout plan exists (ADR-010)', () => {
    const result = computeAdherence(
      [],
      new Date('2026-11-01T00:00:00Z'),
      NOW,
      true,
    );

    expect(result.workoutPercent).toBeNull();
    expect(result.workoutTrackingUnavailable).toBe(true);
    expect(result.hasWorkoutPlan).toBe(true);
  });

  it('UT-013 computes diaryPercent as days logged over days in the window', () => {
    const since = new Date(NOW.getTime() - 30 * DAY_MS);
    const loggedDays = Array.from(
      { length: 20 },
      (_, i) => new Date(since.getTime() + i * DAY_MS),
    );

    const result = computeAdherence(loggedDays, since, NOW, false);

    expect(result.diaryPercent).toBeCloseTo(66.7, 1);
  });

  it('UT-014 returns workoutPercent null / workoutTrackingUnavailable true / hasWorkoutPlan false when no Workout row exists', () => {
    const result = computeAdherence(
      [],
      new Date('2026-11-01T00:00:00Z'),
      NOW,
      false,
    );

    expect(result).toMatchObject({
      workoutPercent: null,
      workoutTrackingUnavailable: true,
      hasWorkoutPlan: false,
    });
  });

  it('UT-015 returns diaryPercent 0, not null or an exception, when zero diary entries exist in the window', () => {
    const result = computeAdherence(
      [],
      new Date('2026-11-01T00:00:00Z'),
      NOW,
      true,
    );

    expect(result.diaryPercent).toBe(0);
  });
});

describe('computeCorrelation', () => {
  it('UT-016 returns one point per overlapping date, with weight and diaryAdherencePercent independently populated', () => {
    const weightPoints = [weightPoint('2026-11-10T12:00:00Z', 70)];
    const diaryDates = datesOnDays(['2026-11-10', '2026-11-11']);

    const correlation = computeCorrelation(weightPoints, diaryDates);

    expect(correlation).toEqual([
      { date: '2026-11-10', weight: 70, diaryAdherencePercent: 100 },
      { date: '2026-11-11', weight: null, diaryAdherencePercent: 100 },
    ]);
  });

  it('UT-017 populates the weight series and leaves diaryAdherencePercent null (not a thrown error) with no diary data for the window', () => {
    const weightPoints = [weightPoint('2026-11-10T12:00:00Z', 70)];

    const correlation = computeCorrelation(weightPoints, []);

    expect(correlation).toEqual([
      { date: '2026-11-10', weight: 70, diaryAdherencePercent: null },
    ]);
  });
});

describe('resolvePreviousMonthStart', () => {
  it('returns BRT midnight on day 1 of the previous month', () => {
    expect(resolvePreviousMonthStart(NOW).toISOString()).toBe(
      '2026-10-01T03:00:00.000Z',
    );
  });
});
