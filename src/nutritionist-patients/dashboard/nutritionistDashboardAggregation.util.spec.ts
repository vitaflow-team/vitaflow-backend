import {
  computeMonthsInCare,
  computeNoDiaryEntryAlerts,
  computeOverduePaymentAlerts,
  computePatientAdherence,
  computePortfolioWeightEvolution,
  groupIntoBuckets,
  isNoDiaryEntry,
  referenceDiaryDate,
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
    createdAt: daysAgo(100), // well past the grace period by default
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
        noDiaryEntryEligible: false,
      },
      {
        clientId: 'b',
        clientName: 'B',
        bucket: 'struggling',
        loggedDayRatio: 0.5,
        daysSinceLastEntry: 1,
        noDiaryEntryEligible: false,
      },
      {
        clientId: 'c',
        clientName: 'C',
        bucket: 'nonAdherent',
        loggedDayRatio: 0.1,
        daysSinceLastEntry: 20,
        noDiaryEntryEligible: true,
      },
      {
        clientId: 'd',
        clientName: 'D',
        bucket: 'noDataYet',
        loggedDayRatio: null,
        daysSinceLastEntry: null,
        noDiaryEntryEligible: true,
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
        noDiaryEntryEligible: true,
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
        noDiaryEntryEligible: true,
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
        noDiaryEntryEligible: false,
      },
    ];

    expect(computeNoDiaryEntryAlerts(entries)).toEqual([]);
  });

  // UT-026 (churn-risk-alert-independent ADR-007): computeNoDiaryEntryAlerts
  // now delegates eligibility entirely to the precomputed flag — a never-
  // logged patient younger than the grace period must never appear, even
  // though daysSinceLastEntry is null (previously the sole trigger).
  it('UT-026 excludes a never-logged patient whose noDiaryEntryEligible is false (younger than the grace period)', () => {
    const entries: PatientAdherenceEntry[] = [
      {
        clientId: 'p1',
        clientName: 'P1',
        bucket: 'noDataYet',
        loggedDayRatio: null,
        daysSinceLastEntry: null,
        noDiaryEntryEligible: false,
      },
    ];

    expect(computeNoDiaryEntryAlerts(entries)).toEqual([]);
  });

  it('UT-027 includes a never-logged patient whose noDiaryEntryEligible is true (past the grace period)', () => {
    const entries: PatientAdherenceEntry[] = [
      {
        clientId: 'p1',
        clientName: 'P1',
        bucket: 'noDataYet',
        loggedDayRatio: null,
        daysSinceLastEntry: null,
        noDiaryEntryEligible: true,
      },
    ];

    expect(computeNoDiaryEntryAlerts(entries)).toEqual([
      expect.objectContaining({ clientId: 'p1' }),
    ]);
  });
});

describe('referenceDiaryDate / isNoDiaryEntry (churn-risk-alert-independent ADR-007)', () => {
  const createdAt = daysAgo(3);

  it('UT-022 returns the last logged entry when one exists, not the relationship creation date', () => {
    const lastEntry = daysAgo(1);
    const result = referenceDiaryDate(
      { id: 'p1', createdAt },
      new Map([['p1', lastEntry]]),
    );

    expect(result).toEqual(lastEntry);
  });

  it('UT-023 falls back to the relationship creation date when the patient has never logged', () => {
    const result = referenceDiaryDate({ id: 'p1', createdAt }, new Map());

    expect(result).toEqual(createdAt);
  });

  it('UT-024 (boundary) is eligible at exactly the 10-day threshold', () => {
    const tenDaysAgo = daysAgo(10);
    const result = isNoDiaryEntry(
      { id: 'p1', createdAt: tenDaysAgo },
      NOW,
      new Map(),
    );

    expect(result).toBe(true);
  });

  it('UT-025 (boundary) is not eligible at 9 days', () => {
    const nineDaysAgo = daysAgo(9);
    const result = isNoDiaryEntry(
      { id: 'p1', createdAt: nineDaysAgo },
      NOW,
      new Map(),
    );

    expect(result).toBe(false);
  });
});

describe('computeOverduePaymentAlerts', () => {
  it('flags only patients present in the overdue set, when billing is available', () => {
    const patients = [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
    ];

    const alerts = computeOverduePaymentAlerts(patients, new Set(['p1']), true);

    expect(alerts).toEqual([{ clientId: 'p1', clientName: 'P1' }]);
  });

  it('returns an empty list when billing is not available, regardless of the overdue set', () => {
    const alerts = computeOverduePaymentAlerts(
      [{ id: 'p1', name: 'P1' }],
      new Set(['p1']),
      false,
    );

    expect(alerts).toEqual([]);
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
