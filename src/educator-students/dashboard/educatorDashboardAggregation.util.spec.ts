import {
  computeCounters,
  computeNoContactAlerts,
  computeRiskRanking,
  type StudentFixture,
} from './educatorDashboardAggregation.util';

const NOW = new Date('2026-11-15T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function student(id: string, createdAtDaysAgo = 365): StudentFixture {
  return { id, name: `Student ${id}`, createdAt: daysAgo(createdAtDaysAgo) };
}

describe('computeCounters', () => {
  it('UT-018 returns {activeCount: 5, inactiveCount: 3, totalCount: 8} for 5 recently-contacted and 3 stale students', () => {
    const students = [
      ...Array.from({ length: 5 }, (_, i) => student(`active-${i}`)),
      ...Array.from({ length: 3 }, (_, i) => student(`inactive-${i}`)),
    ];
    const lastContact = new Map<string, Date>([
      ['active-0', daysAgo(1)],
      ['active-1', daysAgo(2)],
      ['active-2', daysAgo(3)],
      ['active-3', daysAgo(4)],
      ['active-4', daysAgo(9)],
      ['inactive-0', daysAgo(10)],
      ['inactive-1', daysAgo(20)],
      // inactive-2 never had a session; created long ago, so out of grace.
    ]);

    expect(computeCounters(students, lastContact, NOW)).toEqual({
      activeCount: 5,
      inactiveCount: 3,
      totalCount: 8,
    });
  });
});

describe('computeRiskRanking', () => {
  it('UT-019 flags NO_CONTACT (YELLOW) for a student with no session in 10+ days and no overdue invoice', () => {
    const students = [student('s1')];
    const lastContact = new Map([['s1', daysAgo(12)]]);

    const ranking = computeRiskRanking(
      students,
      lastContact,
      new Set(),
      true,
      NOW,
    );

    expect(ranking).toEqual([
      {
        clientId: 's1',
        clientName: 'Student s1',
        severity: 'YELLOW',
        reasons: ['NO_CONTACT'],
        daysSinceLastContact: 12,
        billingAvailable: true,
      },
    ]);
  });

  it('UT-020 omits a student with zero risk conditions from the ranking', () => {
    const students = [student('s1')];
    const lastContact = new Map([['s1', daysAgo(2)]]);

    const ranking = computeRiskRanking(
      students,
      lastContact,
      new Set(),
      true,
      NOW,
    );

    expect(ranking).toEqual([]);
  });

  it('UT-021 does not flag a Client connected 3 days ago with zero sessions yet (grace period anchored to createdAt)', () => {
    const students = [student('s1', 3)];

    const ranking = computeRiskRanking(
      students,
      new Map(),
      new Set(),
      true,
      NOW,
    );

    expect(ranking).toEqual([]);
  });

  it('UT-022 returns both reasons (RED) for a student with an overdue invoice and 12 days since last session', () => {
    const students = [student('s1')];
    const lastContact = new Map([['s1', daysAgo(12)]]);

    const ranking = computeRiskRanking(
      students,
      lastContact,
      new Set(['s1']),
      true,
      NOW,
    );

    expect(ranking).toHaveLength(1);
    expect(ranking[0].severity).toBe('RED');
    expect(ranking[0].reasons).toEqual(
      expect.arrayContaining(['NO_CONTACT', 'OVERDUE_PAYMENT']),
    );
    expect(ranking[0].reasons).toHaveLength(2);
  });

  it('UT-023 caps a 220-student at-risk portfolio at exactly 50, severity-sorted then by daysSinceLastContact descending', () => {
    const redStudents = Array.from({ length: 30 }, (_, i) =>
      student(`red-${i}`),
    );
    const yellowStudents = Array.from({ length: 190 }, (_, i) =>
      student(`yellow-${i}`),
    );
    const students = [...redStudents, ...yellowStudents];
    const lastContact = new Map<string, Date>();
    const overdueClientIds = new Set<string>();
    redStudents.forEach((s, i) => {
      lastContact.set(s.id, daysAgo(10 + i));
      overdueClientIds.add(s.id);
    });
    yellowStudents.forEach((s, i) => lastContact.set(s.id, daysAgo(10 + i)));

    const ranking = computeRiskRanking(
      students,
      lastContact,
      overdueClientIds,
      true,
      NOW,
    );

    expect(ranking).toHaveLength(50);
    expect(
      ranking.slice(0, 30).every((entry) => entry.severity === 'RED'),
    ).toBe(true);
    expect(
      ranking.slice(30).every((entry) => entry.severity === 'YELLOW'),
    ).toBe(true);
    const yellowDays = ranking.slice(30).map((e) => e.daysSinceLastContact);
    expect(yellowDays).toEqual(
      [...yellowDays].sort((a, b) => (b ?? 0) - (a ?? 0)),
    );
  });

  it('UT-024 sets billingAvailable false with no default OVERDUE_PAYMENT when the professional has no connected billing account', () => {
    const students = [student('s1')];
    const lastContact = new Map([['s1', daysAgo(12)]]);

    const ranking = computeRiskRanking(
      students,
      lastContact,
      new Set(['s1']),
      false,
      NOW,
    );

    expect(ranking).toEqual([
      expect.objectContaining({
        reasons: ['NO_CONTACT'],
        billingAvailable: false,
      }),
    ]);
  });
});

describe('computeNoContactAlerts', () => {
  it('UT-028 returns only NO_CONTACT-flagged entries from the ranking, sorted by daysSinceLastContact descending', () => {
    const students = [student('s1'), student('s2')];
    const lastContact = new Map([
      ['s1', daysAgo(12)],
      ['s2', daysAgo(20)],
    ]);
    const ranking = computeRiskRanking(
      students,
      lastContact,
      new Set(['s1']),
      true,
      NOW,
    );

    const alerts = computeNoContactAlerts(ranking);

    expect(alerts.map((a) => a.clientId)).toEqual(['s2', 's1']);
  });

  it('UT-029 returns an explicit empty array when no student has the NO_CONTACT reason', () => {
    const students = [student('s1')];
    const lastContact = new Map([['s1', daysAgo(1)]]);
    const ranking = computeRiskRanking(
      students,
      lastContact,
      new Set(['s1']),
      true,
      NOW,
    );

    expect(computeNoContactAlerts(ranking)).toEqual([]);
  });
});
