import {
  brasiliaDateKey,
  currentCompetence,
  validateCompetence,
  validateDueDate,
} from './dates';

const TODAY = '2026-10-02';

describe('due date and competence rules (UT-002, UT-003)', () => {
  it('uses the Brasília calendar date, not UTC', () => {
    // 01:00 UTC on Oct 3 is 22:00 on Oct 2 in Brasília.
    expect(brasiliaDateKey(new Date('2026-10-03T01:00:00Z'))).toBe(
      '2026-10-02',
    );
  });

  it('accepts a due date from today to 90 days ahead and rejects anything else', () => {
    expect(validateDueDate('2026-10-02', TODAY)).toBe('2026-10-02');
    expect(validateDueDate('2026-12-31', TODAY)).toBe('2026-12-31');
    expect(() => validateDueDate('2026-10-01', TODAY)).toThrow();
    expect(() => validateDueDate('2027-01-01', TODAY)).toThrow();
    expect(() => validateDueDate('2026-13-40', TODAY)).toThrow();
  });

  it('accepts competence within 12 months of the current month and defaults to it', () => {
    expect(validateCompetence(2025, 10, TODAY)).toEqual({
      year: 2025,
      month: 10,
    });
    expect(validateCompetence(2027, 10, TODAY)).toEqual({
      year: 2027,
      month: 10,
    });
    expect(() => validateCompetence(2025, 9, TODAY)).toThrow();
    expect(() => validateCompetence(2027, 11, TODAY)).toThrow();
    expect(() => validateCompetence(2026, 0, TODAY)).toThrow();
    expect(() => validateCompetence(2026, 13, TODAY)).toThrow();
    expect(currentCompetence(TODAY)).toEqual({ year: 2026, month: 10 });
  });
});
