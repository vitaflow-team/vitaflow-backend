import {
  assessedOnToInstant,
  isRealCalendarDate,
  parseAssessedOn,
  todayInBrt,
} from './assessedOnTimestamp.util';

describe('assessedOn timestamp util', () => {
  it.each([
    ['2026-09-15', '2026-09-15T15:00:00.000Z'],
    ['2026-01-01', '2026-01-01T15:00:00.000Z'],
  ])('UT-021 turns %s into noon Brasília time (%s)', (day, expected) => {
    expect(assessedOnToInstant(parseAssessedOn(day)).toISOString()).toBe(
      expected,
    );
  });

  it('todayInBrt follows the Brasília calendar day, not UTC', () => {
    expect(todayInBrt(new Date('2026-10-03T02:30:00.000Z'))).toBe('2026-10-02');
    expect(todayInBrt(new Date('2026-10-03T03:00:00.000Z'))).toBe('2026-10-03');
  });

  it.each([
    ['2026-09-15', true],
    ['2028-02-29', true],
    ['2026-02-30', false],
    ['2026-13-40', false],
    ['2026-9-5', false],
    ['', false],
  ])('isRealCalendarDate(%p) is %p', (value, expected) => {
    expect(isRealCalendarDate(value)).toBe(expected);
  });
});
