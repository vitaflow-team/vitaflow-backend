import {
  computeMonthsInCare,
  computeNoDiaryEntryAlerts,
  computePatientAdherence,
  computePortfolioWeightEvolution,
  groupIntoBuckets,
  type PatientAdherenceEntry,
  type PatientAdherenceInput,
} from './nutritionistDashboardAggregation.util';
import {
  computeSmoothedTrend,
  type WeightPoint,
} from '@/progress/progressDashboardAggregation.util';

const NOW = new Date('2026-11-15T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function datesOnDays(brtDates: string[]): Date[] {
  return brtDates.map((date) => new Date(`${date}T15:00:00Z`));
}

function baseInput(
  overrides: Partial<PatientAdherenceInput> = {},
): PatientAdherenceInput {
  return {
    clientId: 'p1',
    clientName: 'Patient 1',
    mealLoggedDates: [],
    lastEntryAt: null,
    since: null,
    ...overrides,
  };
}

describe('computePatientAdherence', () => {
  it('UT-030 classifies Compliant at exactly 70% of elapsed days (inclusive)', () => {
    const since = daysAgo(10); // elapsed = 10 days
    const loggedDates = datesOnDays([
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ]); // 7 of 10 days = 70%

    const result = computePatientAdherence(
      baseInput({
        since,
        mealLoggedDates: loggedDates,
        lastEntryAt: loggedDates[6],
      }),
      NOW,
    );

    expect(result.bucket).toBe('compliant');
    expect(result.loggedDayRatio).toBeCloseTo(0.7, 3);
  });

  it('UT-031 classifies Em dificuldade at exactly 30% of elapsed days (inclusive lower bound)', () => {
    const since = daysAgo(10);
    const loggedDates = datesOnDays(['2026-11-06', '2026-11-07', '2026-11-08']); // 3/10 = 30%

    const result = computePatientAdherence(
      baseInput({
        since,
        mealLoggedDates: loggedDates,
        lastEntryAt: loggedDates[2],
      }),
      NOW,
    );

    expect(result.bucket).toBe('struggling');
  });

  it('UT-032 classifies Não aderente at 29% of elapsed days', () => {
    const since = daysAgo(100);
    const loggedDates = datesOnDays(
      Array.from({ length: 29 }, (_, i) => {
        const d = new Date(daysAgo(99 - i));
        return d.toISOString().slice(0, 10);
      }),
    );

    const result = computePatientAdherence(
      baseInput({
        since,
        mealLoggedDates: loggedDates,
        lastEntryAt: loggedDates.at(-1),
      }),
      NOW,
    );

    expect(result.bucket).toBe('nonAdherent');
  });

  it('UT-033 excludes a patient with no active plan and no diary history into noDataYet (since: null)', () => {
    const result = computePatientAdherence(baseInput({ since: null }), NOW);

    expect(result.bucket).toBe('noDataYet');
    expect(result.loggedDayRatio).toBeNull();
  });

  it('UT-034 uses only elapsed days so far, not a fixed/full period length, as the denominator', () => {
    // Plan published 10 days ago; 5 logged days so far. If the denominator
    // were wrongly fixed at (e.g.) 30, the ratio would read as 5/30 (16.7%,
    // Não aderente) instead of the correct 5/10 (50%, Em dificuldade).
    const since = daysAgo(10);
    const loggedDates = datesOnDays([
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
    ]);

    const result = computePatientAdherence(
      baseInput({
        since,
        mealLoggedDates: loggedDates,
        lastEntryAt: loggedDates.at(-1),
      }),
      NOW,
    );

    expect(result.loggedDayRatio).toBeCloseTo(0.5, 3);
    expect(result.bucket).toBe('struggling');
  });
});

describe('groupIntoBuckets', () => {
  it('routes each patient to exactly one of the four buckets', () => {
    const entries: PatientAdherenceEntry[] = [
      {
        clientId: 'a',
        clientName: 'A',
        bucket: 'compliant',
        loggedDayRatio: 0.9,
        daysSinceLastEntry: 0,
      },
      {
        clientId: 'b',
        clientName: 'B',
        bucket: 'struggling',
        loggedDayRatio: 0.5,
        daysSinceLastEntry: 1,
      },
      {
        clientId: 'c',
        clientName: 'C',
        bucket: 'nonAdherent',
        loggedDayRatio: 0.1,
        daysSinceLastEntry: 20,
      },
      {
        clientId: 'd',
        clientName: 'D',
        bucket: 'noDataYet',
        loggedDayRatio: null,
        daysSinceLastEntry: null,
      },
    ];

    const buckets = groupIntoBuckets(entries);

    expect(buckets.compliant.map((e) => e.clientId)).toEqual(['a']);
    expect(buckets.struggling.map((e) => e.clientId)).toEqual(['b']);
    expect(buckets.nonAdherent.map((e) => e.clientId)).toEqual(['c']);
    expect(buckets.noDataYet.map((e) => e.clientId)).toEqual(['d']);
  });
});

describe('computeNoDiaryEntryAlerts', () => {
  it('UT-035 flags a patient whose last entry is 12 days ago against a 10-day threshold, with daysSinceLastEntry: 12', () => {
    const entries: PatientAdherenceEntry[] = [
      {
        clientId: 'p1',
        clientName: 'P1',
        bucket: 'nonAdherent',
        loggedDayRatio: 0.1,
        daysSinceLastEntry: 12,
      },
    ];

    const alerts = computeNoDiaryEntryAlerts(entries);

    expect(alerts).toEqual([
      expect.objectContaining({ clientId: 'p1', daysSinceLastEntry: 12 }),
    ]);
  });

  it('UT-036 flags a never-logged patient with daysSinceLastEntry: null, distinct from a fabricated day count', () => {
    const entries: PatientAdherenceEntry[] = [
      {
        clientId: 'p1',
        clientName: 'P1',
        bucket: 'noDataYet',
        loggedDayRatio: null,
        daysSinceLastEntry: null,
      },
    ];

    const alerts = computeNoDiaryEntryAlerts(entries);

    expect(alerts).toEqual([
      expect.objectContaining({ clientId: 'p1', daysSinceLastEntry: null }),
    ]);
  });

  it('does not flag a patient logged within the threshold', () => {
    const entries: PatientAdherenceEntry[] = [
      {
        clientId: 'p1',
        clientName: 'P1',
        bucket: 'compliant',
        loggedDayRatio: 0.9,
        daysSinceLastEntry: 2,
      },
    ];

    expect(computeNoDiaryEntryAlerts(entries)).toEqual([]);
  });
});

describe('computeMonthsInCare', () => {
  it('returns 0 for the connection month itself and increments per calendar month after', () => {
    const createdAt = new Date('2026-01-15T00:00:00Z');

    expect(computeMonthsInCare(createdAt, 2026, 1)).toBe(0);
    expect(computeMonthsInCare(createdAt, 2026, 2)).toBe(1);
    expect(computeMonthsInCare(createdAt, 2027, 1)).toBe(12);
  });
});

describe('computePortfolioWeightEvolution', () => {
  it("UT-037/UT-038 normalizes to percent change from each patient's own starting weight, not a raw average", () => {
    const createdAtByUser = new Map([
      ['u1', new Date('2026-01-01T00:00:00Z')],
      ['u2', new Date('2026-01-01T00:00:00Z')],
    ]);
    const points = [
      { userId: 'u1', year: 2026, month: 1, avgWeightKg: 100 },
      { userId: 'u1', year: 2026, month: 2, avgWeightKg: 90 }, // -10%
      { userId: 'u2', year: 2026, month: 1, avgWeightKg: 50 },
      { userId: 'u2', year: 2026, month: 2, avgWeightKg: 55 }, // +10%
    ];

    const result = computePortfolioWeightEvolution(points, createdAtByUser);

    expect(result).toEqual([
      {
        monthsInCare: 0,
        avgPercentChangeFromStart: 0,
        contributingPatientCount: 2,
      },
      {
        monthsInCare: 1,
        avgPercentChangeFromStart: 0,
        contributingPatientCount: 2,
      },
    ]);
  });

  it('UT-039 computes the aggregate from only the patients with data, with contributingPatientCount explicit', () => {
    const createdAtByUser = new Map([
      ['u1', new Date('2026-01-01T00:00:00Z')],
      ['u2', new Date('2026-01-01T00:00:00Z')],
    ]);
    // Only u1 and u2 have MeasurementRecord points; the other 28 of a
    // hypothetical 30-patient portfolio simply never appear in `points`.
    const points = [
      { userId: 'u1', year: 2026, month: 1, avgWeightKg: 100 },
      { userId: 'u2', year: 2026, month: 1, avgWeightKg: 80 },
    ];

    const result = computePortfolioWeightEvolution(points, createdAtByUser);

    expect(result).toEqual([
      {
        monthsInCare: 0,
        avgPercentChangeFromStart: 0,
        contributingPatientCount: 2,
      },
    ]);
  });

  it('UT-040 never extrapolates into a month a patient stopped logging in — only months with real data count', () => {
    const createdAtByUser = new Map([
      ['u1', new Date('2026-01-01T00:00:00Z')],
      ['u2', new Date('2026-01-01T00:00:00Z')],
    ]);
    const points = [
      { userId: 'u1', year: 2026, month: 1, avgWeightKg: 100 },
      { userId: 'u1', year: 2026, month: 2, avgWeightKg: 95 },
      { userId: 'u1', year: 2026, month: 3, avgWeightKg: 90 },
      // u2 stopped logging after month 1 — contributes nothing to months 2/3.
      { userId: 'u2', year: 2026, month: 1, avgWeightKg: 60 },
    ];

    const result = computePortfolioWeightEvolution(points, createdAtByUser);

    const monthTwo = result.find((point) => point.monthsInCare === 1)!;
    const monthThree = result.find((point) => point.monthsInCare === 2)!;
    expect(monthTwo.contributingPatientCount).toBe(1);
    expect(monthThree.contributingPatientCount).toBe(1);
  });
});

describe('UT-038: individual patient evolution reuses the student-facing trend shape', () => {
  it('produces the same TrendPoint shape as the student dashboard (UT-001), read from the professional side', () => {
    const points: WeightPoint[] = Array.from({ length: 8 }, (_, i) => ({
      recordedAt: daysAgo(7 - i),
      weightKg: 70 + i,
    }));

    const trend = computeSmoothedTrend(points);

    expect(trend).toHaveLength(8);
    expect(trend[0]).toEqual({
      recordedAt: points[0].recordedAt.toISOString(),
      weightKg: 70,
      smoothedWeightKg: null,
    });
    expect(trend[6].smoothedWeightKg).not.toBeNull();
  });
});
