import {
  computeAtRisk,
  computeRecentFeed,
  computeTodayCount,
  computeWeeklyFrequency,
  resolveLookbackDays,
  type CheckInFixture,
} from './engajamentoAggregation.util';

const NOW = new Date('2026-11-15T15:00:00Z'); // 12:00 BRT

function checkIn(
  clientId: string,
  createdAt: string,
  overrides: Partial<CheckInFixture> = {},
): CheckInFixture {
  return {
    clientId,
    createdAt: new Date(createdAt),
    source: 'SELF',
    planValidAtCheckIn: true,
    clientName: `Client ${clientId}`,
    ...overrides,
  };
}

describe('computeTodayCount', () => {
  it('UT-015 counts distinct students with a check-in today, not raw rows', () => {
    const checkIns = [
      checkIn('c1', '2026-11-15T13:00:00Z'),
      checkIn('c1', '2026-11-15T18:00:00Z'),
      checkIn('c2', '2026-11-15T14:00:00Z'),
      checkIn('c3', '2026-11-14T14:00:00Z'),
    ];

    expect(computeTodayCount(checkIns, NOW)).toBe(2);
  });

  it('UT-015 (zero variant) returns an explicit 0 with no check-ins today', () => {
    expect(computeTodayCount([], NOW)).toBe(0);
  });
});

describe('computeWeeklyFrequency', () => {
  it('UT-016 averages distinct (clientId, BRT day) pairs over the window divided by weeks', () => {
    const checkIns = [
      checkIn('c1', '2026-11-01T13:00:00Z'),
      checkIn('c1', '2026-11-08T13:00:00Z'),
      checkIn('c1', '2026-11-08T18:00:00Z'), // same BRT day as above, counts once
      checkIn('c2', '2026-11-01T13:00:00Z'),
    ];

    // 3 distinct (client, day) pairs / 4 weeks / 2 students = 0.375
    expect(computeWeeklyFrequency(checkIns, 28, 2)).toBeCloseTo(0.375);
  });

  it('returns 0 when the academia has no gym students', () => {
    expect(computeWeeklyFrequency([], 28, 0)).toBe(0);
  });

  it('UT-017 a shorter clamped window changes the divisor, not just the data', () => {
    const checkIns = [checkIn('c1', '2026-11-14T13:00:00Z')];

    // 1 pair / (7/7 weeks) / 1 student = 1, vs. a full 28-day window's / 4
    expect(computeWeeklyFrequency(checkIns, 7, 1)).toBeCloseTo(1);
    expect(computeWeeklyFrequency(checkIns, 28, 1)).toBeCloseTo(0.25);
  });
});

describe('resolveLookbackDays', () => {
  it("UT-017 clamps to the academia's actual age when younger than 28 days", () => {
    const youngAcademia = new Date('2026-11-10T15:00:00Z'); // exactly 5 days old
    expect(resolveLookbackDays(youngAcademia, NOW)).toBe(5);
  });

  it('caps at the full 28-day window for a mature academia', () => {
    const matureAcademia = new Date('2026-01-01T00:00:00Z');
    expect(resolveLookbackDays(matureAcademia, NOW)).toBe(28);
  });

  it('never returns less than 1, even for an academia created today', () => {
    expect(resolveLookbackDays(NOW, NOW)).toBe(1);
  });
});

describe('computeAtRisk', () => {
  it('UT-018 includes a student 10+ BRT days since their last check-in, excludes one within 9', () => {
    const students = [
      { id: 'c1', name: 'Diego' },
      { id: 'c2', name: 'Fernanda' },
    ];
    const lastCheckIn = new Map([
      ['c1', new Date('2026-11-04T13:00:00Z')], // 11 days ago
      ['c2', new Date('2026-11-10T13:00:00Z')], // 5 days ago
    ]);

    const result = computeAtRisk(students, lastCheckIn, NOW);

    expect(result).toEqual([
      {
        clientId: 'c1',
        name: 'Diego',
        lastCheckInAt: '2026-11-04T13:00:00.000Z',
      },
    ]);
  });

  it('UT-019 includes a student who has never checked in, with lastCheckInAt null', () => {
    const students = [{ id: 'c1', name: 'Diego' }];

    const result = computeAtRisk(students, new Map(), NOW);

    expect(result).toEqual([
      { clientId: 'c1', name: 'Diego', lastCheckInAt: null },
    ]);
  });
});

describe('computeRecentFeed', () => {
  it('UT-020 orders entries newest-first', () => {
    const checkIns = [
      checkIn('c1', '2026-11-10T13:00:00Z'),
      checkIn('c2', '2026-11-12T13:00:00Z'),
      checkIn('c3', '2026-11-11T13:00:00Z'),
    ];

    const result = computeRecentFeed(checkIns);

    expect(result.map((entry) => entry.clientId)).toEqual(['c2', 'c3', 'c1']);
  });

  it('UT-021 bounds the feed even with a large number of rows', () => {
    const checkIns = Array.from({ length: 200 }, (_, i) =>
      checkIn(`c${i}`, `2026-11-01T${String(i % 24).padStart(2, '0')}:00:00Z`),
    );

    const result = computeRecentFeed(checkIns, 50);

    expect(result).toHaveLength(50);
  });
});
