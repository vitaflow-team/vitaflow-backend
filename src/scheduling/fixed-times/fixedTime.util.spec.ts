import { SessionType } from '@prisma/client';
import {
  brtDateKey,
  educatorScheduleLockKey,
  findEarliestConflict,
  FixedTimeRule,
  occurrencesBetween,
  OccupancyRow,
  rangesOverlap,
  resolveLetter,
  todaySession,
  validateRule,
} from './fixedTime.util';

const rule = (overrides: Partial<FixedTimeRule> = {}): FixedTimeRule => ({
  weekday: 1,
  startMinute: 7 * 60,
  durationMinutes: 60,
  type: SessionType.PRESENCIAL,
  onlineLink: null,
  workoutLetter: null,
  ...overrides,
});

const at = (iso: string) => new Date(iso);

describe('validateRule (UT-001 to UT-005)', () => {
  it.each([
    [0, false],
    [1, true],
    [7, true],
    [8, false],
    [2.5, false],
  ])('UT-001 weekday %p is valid: %p', (weekday, valid) => {
    const problems = validateRule(rule({ weekday }));
    expect(problems.some((p) => p.field === 'weekday')).toBe(!valid);
  });

  it.each([
    [0, true],
    [1435, true],
    [423, false],
    [-5, false],
    [1436, false],
  ])('UT-002 start minute %p is valid: %p', (startMinute, valid) => {
    const problems = validateRule(rule({ startMinute }));
    expect(problems.some((p) => p.field === 'startMinute')).toBe(!valid);
  });

  it('UT-002 a session may end exactly at midnight but not after it', () => {
    expect(
      validateRule(rule({ startMinute: 22 * 60, durationMinutes: 120 })),
    ).toEqual([]);
    expect(
      validateRule(
        rule({ startMinute: 22 * 60 + 5, durationMinutes: 120 }),
      ).map((p) => p.field),
    ).toContain('durationMinutes');
  });

  it.each([
    [15, true],
    [240, true],
    [10, false],
    [245, false],
    [62, false],
  ])('UT-003 duration %p is valid: %p', (durationMinutes, valid) => {
    const problems = validateRule(rule({ durationMinutes }));
    expect(problems.some((p) => p.field === 'durationMinutes')).toBe(!valid);
  });

  it('UT-004 an online link is accepted for online times only', () => {
    expect(
      validateRule(
        rule({
          type: SessionType.ONLINE,
          onlineLink: 'https://meet.exemplo.com/x',
        }),
      ),
    ).toEqual([]);
    expect(
      validateRule(
        rule({ type: SessionType.ONLINE, onlineLink: 'http://x.com/y' }),
      ),
    ).toEqual([]);
    expect(
      validateRule(
        rule({ type: SessionType.PRESENCIAL, onlineLink: 'https://x.com' }),
      ),
    ).toEqual([{ field: 'onlineLink', code: 'link_not_allowed' }]);
  });

  it.each([
    'javascript:alert(1)',
    'file:///c:/x',
    'data:text/html,x',
    'ftp://x',
    'https://x.com/a b',
    'https://x.com/<b>',
    `https://x.com/${'a'.repeat(490)}`,
  ])('UT-004 rejects the link %s', (onlineLink) => {
    const problems = validateRule(
      rule({ type: SessionType.ONLINE, onlineLink }),
    );
    expect(problems).toEqual([{ field: 'onlineLink', code: 'invalid' }]);
  });

  it('UT-004 accepts exactly 500 characters and rejects 501', () => {
    const base = 'https://x.com/';
    const ok = base + 'a'.repeat(500 - base.length);
    const tooLong = base + 'a'.repeat(501 - base.length);
    expect(
      validateRule(rule({ type: SessionType.ONLINE, onlineLink: ok })),
    ).toEqual([]);
    expect(
      validateRule(rule({ type: SessionType.ONLINE, onlineLink: tooLong })),
    ).toEqual([{ field: 'onlineLink', code: 'invalid' }]);
  });

  it.each([
    ['A', true],
    ['G', true],
    ['H', false],
    ['a', false],
    ['AA', false],
    ['', false],
  ])('UT-005 workout letter %p is valid: %p', (workoutLetter, valid) => {
    const problems = validateRule(rule({ workoutLetter }));
    expect(problems.some((p) => p.field === 'workoutLetter')).toBe(!valid);
  });

  it('UT-005 an absent letter is accepted', () => {
    expect(validateRule(rule({ workoutLetter: null }))).toEqual([]);
  });
});

describe('occurrencesBetween (UT-006 to UT-009)', () => {
  it('UT-006 returns the Mondays at 10:00Z (07:00 Brasília) for 35 days', () => {
    const from = at('2026-10-07T10:00:00Z');
    const until = new Date(from.getTime() + 35 * 24 * 60 * 60 * 1000);

    const starts = occurrencesBetween(rule(), from, until).map((r) =>
      r.startAt.toISOString(),
    );

    expect(starts).toEqual([
      '2026-10-12T10:00:00.000Z',
      '2026-10-19T10:00:00.000Z',
      '2026-10-26T10:00:00.000Z',
      '2026-11-02T10:00:00.000Z',
      '2026-11-09T10:00:00.000Z',
    ]);
  });

  it('UT-007 keeps an occurrence that starts exactly at `from` and drops one that has started', () => {
    const until = at('2026-10-20T00:00:00Z');
    const monday = '2026-10-12';

    const before = occurrencesBetween(
      rule(),
      at(`${monday}T06:30:00-03:00`),
      until,
    );
    const exact = occurrencesBetween(
      rule(),
      at(`${monday}T07:00:00-03:00`),
      until,
    );
    const after = occurrencesBetween(
      rule(),
      at(`${monday}T07:00:01-03:00`),
      until,
    );

    expect(before[0].startAt.toISOString()).toBe(`${monday}T10:00:00.000Z`);
    expect(exact[0].startAt.toISOString()).toBe(`${monday}T10:00:00.000Z`);
    expect(after.map((r) => r.startAt.toISOString())).not.toContain(
      `${monday}T10:00:00.000Z`,
    );
  });

  it('UT-008 is correct across the month and year ends and late Sunday starts', () => {
    const from = at('2026-12-28T12:00:00Z');
    const until = at('2027-01-15T12:00:00Z');
    const saturday = occurrencesBetween(
      rule({ weekday: 6, startMinute: 0 }),
      from,
      until,
    ).map((r) => r.startAt.toISOString());
    expect(saturday).toEqual([
      '2027-01-02T03:00:00.000Z',
      '2027-01-09T03:00:00.000Z',
    ]);

    const sundayLate = occurrencesBetween(
      rule({ weekday: 7, startMinute: 23 * 60 }),
      at('2026-10-10T12:00:00Z'),
      at('2026-10-12T12:00:00Z'),
    );
    expect(sundayLate).toHaveLength(1);
    expect(sundayLate[0].startAt.toISOString()).toBe(
      '2026-10-12T02:00:00.000Z',
    );
    expect(brtDateKey(sundayLate[0].startAt)).toBe('2026-10-11');
  });

  it('UT-009 skips the listed Brasília dates only', () => {
    const from = at('2026-10-07T10:00:00Z');
    const until = at('2026-10-27T10:00:00Z');

    const starts = occurrencesBetween(
      rule(),
      from,
      until,
      new Set(['2026-10-12']),
    ).map((r) => brtDateKey(r.startAt));

    expect(starts).toEqual(['2026-10-19', '2026-10-26']);
  });
});

describe('rangesOverlap (UT-010)', () => {
  const range = (start: string, end: string) => ({
    startAt: at(`2026-10-12T${start}:00-03:00`),
    endAt: at(`2026-10-12T${end}:00-03:00`),
  });

  it('treats one minute of overlap as a conflict', () => {
    expect(
      rangesOverlap(range('07:00', '08:00'), range('07:59', '08:30')),
    ).toBe(true);
  });

  it('treats touching ranges as not overlapping', () => {
    expect(
      rangesOverlap(range('07:00', '08:00'), range('08:00', '09:00')),
    ).toBe(false);
    expect(
      rangesOverlap(range('08:00', '09:00'), range('07:00', '08:00')),
    ).toBe(false);
  });

  it('finds containment and disjoint ranges', () => {
    expect(
      rangesOverlap(range('07:00', '09:00'), range('07:30', '08:00')),
    ).toBe(true);
    expect(
      rangesOverlap(range('07:00', '08:00'), range('09:00', '10:00')),
    ).toBe(false);
  });
});

describe('findEarliestConflict (UT-011)', () => {
  const window = [
    { startAt: at('2026-10-12T10:00:00Z'), endAt: at('2026-10-12T11:00:00Z') },
  ];
  const row = (
    status: OccupancyRow['status'],
    start: string,
    end: string,
    studentName: string,
    fixedTimeId: string | null = 'ft-1',
  ): OccupancyRow => ({
    startAt: at(start),
    endAt: at(end),
    status,
    fixedTimeId,
    studentName,
  });

  it('returns the earliest of several conflicts', () => {
    const conflict = findEarliestConflict(window, [
      row('SCHEDULED', '2026-10-12T10:30:00Z', '2026-10-12T11:30:00Z', 'Bruna'),
      row(
        'BOOKED',
        '2026-10-12T10:10:00Z',
        '2026-10-12T10:40:00Z',
        'Ana',
        null,
      ),
    ]);

    expect(conflict?.studentName).toBe('Ana');
  });

  it('ignores canceled rows', () => {
    const conflict = findEarliestConflict(window, [
      row('CANCELED', '2026-10-12T10:00:00Z', '2026-10-12T11:00:00Z', 'Bruna'),
    ]);

    expect(conflict).toBeNull();
  });

  it('ignores the rows of the fixed time being edited', () => {
    const conflict = findEarliestConflict(
      window,
      [
        row(
          'SCHEDULED',
          '2026-10-12T10:00:00Z',
          '2026-10-12T11:00:00Z',
          'Bruna',
          'ft-1',
        ),
      ],
      'ft-1',
    );

    expect(conflict).toBeNull();
  });

  it('keeps conflicts of other fixed times when one is ignored', () => {
    const conflict = findEarliestConflict(
      window,
      [
        row(
          'SCHEDULED',
          '2026-10-12T10:00:00Z',
          '2026-10-12T11:00:00Z',
          'Bruna',
          'ft-2',
        ),
      ],
      'ft-1',
    );

    expect(conflict?.studentName).toBe('Bruna');
  });
});

describe('letter resolution and today (UT-012, UT-013)', () => {
  it('UT-012 maps B to the second session by position', () => {
    expect(resolveLetter('B', ['Peito', 'Costas'])).toEqual({
      sessionName: 'Costas',
      missing: false,
    });
  });

  it('UT-012 reports a letter beyond the sessions as missing', () => {
    expect(resolveLetter('C', ['Peito', 'Costas'])).toEqual({
      sessionName: null,
      missing: true,
    });
  });

  it('UT-012 with no active workout there is no name and nothing is missing', () => {
    expect(resolveLetter('A', null)).toEqual({
      sessionName: null,
      missing: false,
    });
    expect(resolveLetter(null, ['Peito'])).toEqual({
      sessionName: null,
      missing: false,
    });
  });

  const day = (start: string, end: string, workoutLetter: string | null) => ({
    startAt: at(`2026-10-12T${start}:00-03:00`),
    endAt: at(`2026-10-12T${end}:00-03:00`),
    workoutLetter,
  });
  const resolvesAll = () => true;

  it('UT-013 picks the earliest session of today that has not ended', () => {
    const candidates = [day('07:00', '08:00', 'A'), day('18:00', '19:00', 'B')];

    expect(
      todaySession(candidates, at('2026-10-12T06:00:00-03:00'), resolvesAll)
        ?.workoutLetter,
    ).toBe('A');
    expect(
      todaySession(candidates, at('2026-10-12T09:00:00-03:00'), resolvesAll)
        ?.workoutLetter,
    ).toBe('B');
    expect(
      todaySession(candidates, at('2026-10-12T20:00:00-03:00'), resolvesAll),
    ).toBeNull();
  });

  it('UT-013 skips a session whose letter does not resolve', () => {
    const candidates = [day('07:00', '08:00', 'C'), day('18:00', '19:00', 'A')];

    const found = todaySession(
      candidates,
      at('2026-10-12T06:00:00-03:00'),
      (letter) => letter === 'A',
    );

    expect(found?.workoutLetter).toBe('A');
  });
});

describe('lock key', () => {
  it('keys the advisory lock by educator', () => {
    expect(educatorScheduleLockKey('e1')).toBe('educator-schedule:e1');
    expect(educatorScheduleLockKey('e1')).not.toBe(
      educatorScheduleLockKey('e2'),
    );
  });
});
