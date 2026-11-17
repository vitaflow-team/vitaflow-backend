import { nextCompetenceToIssue, planFees } from './recurringSchedule';

describe('nextCompetenceToIssue', () => {
  it('is the month after the highest invoice competence', () => {
    expect(
      nextCompetenceToIssue({
        last: { year: 2026, month: 12 },
        dueDay: 10,
        startedAtKey: '2026-01-05',
      }),
    ).toEqual({ year: 2027, month: 1 });
  });

  it('is the first competence when the row has no invoice yet', () => {
    expect(
      nextCompetenceToIssue({
        last: null,
        dueDay: 10,
        startedAtKey: '2026-11-17',
      }),
    ).toEqual({ year: 2026, month: 12 });
  });
});

describe('planFees', () => {
  const next = { year: 2026, month: 11 };

  it('issues a month whose due date is exactly 10 days away, not 11', () => {
    expect(planFees({ next, dueDay: 27, today: '2026-11-16' }).fees).toEqual(
      [],
    );
    expect(planFees({ next, dueDay: 27, today: '2026-11-17' }).fees).toEqual([
      { competence: next, dueDate: '2026-11-27' },
    ]);
  });

  it('issues a fee due today with its own date', () => {
    expect(planFees({ next, dueDay: 17, today: '2026-11-17' }).fees).toEqual([
      { competence: next, dueDate: '2026-11-17' },
    ]);
  });

  it('catches up missed months with due date today and their original competence', () => {
    const plan = planFees({
      next: { year: 2026, month: 9 },
      dueDay: 28,
      today: '2026-11-17',
    });

    expect(plan.fees).toEqual([
      { competence: { year: 2026, month: 9 }, dueDate: '2026-11-17' },
      { competence: { year: 2026, month: 10 }, dueDate: '2026-11-17' },
    ]);
    expect(plan.cappedMonths).toBe(0);
  });

  it('keeps only the three most recent missed months and reports the rest as capped', () => {
    const plan = planFees({
      next: { year: 2026, month: 6 },
      dueDay: 28,
      today: '2026-11-17',
    });

    expect(plan.fees.map((fee) => fee.competence.month)).toEqual([8, 9, 10]);
    expect(plan.cappedMonths).toBe(2);
  });

  it('adds the upcoming month after the caught-up ones', () => {
    const plan = planFees({
      next: { year: 2026, month: 10 },
      dueDay: 20,
      today: '2026-11-17',
    });

    expect(plan.fees).toEqual([
      { competence: { year: 2026, month: 10 }, dueDate: '2026-11-17' },
      { competence: { year: 2026, month: 11 }, dueDate: '2026-11-20' },
    ]);
  });

  it('crosses the year boundary', () => {
    const plan = planFees({
      next: { year: 2026, month: 12 },
      dueDay: 5,
      today: '2026-12-28',
    });

    expect(plan.fees).toEqual([
      { competence: { year: 2026, month: 12 }, dueDate: '2026-12-28' },
      { competence: { year: 2027, month: 1 }, dueDate: '2027-01-05' },
    ]);
  });
});
