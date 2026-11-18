import { InvoiceStatus } from '@prisma/client';
import {
  bandOf,
  changeVsPrevious,
  isOverdue,
  parseMonth,
  previousMonth,
  requestedPage,
  resolvePage,
  todayKey,
} from './financialDefinitions';

const TODAY = '2026-11-17';

function invalidMonthOf(raw: string | undefined, today = TODAY): unknown {
  try {
    parseMonth(raw, today);
  } catch (error: unknown) {
    return error;
  }
  return null;
}

describe('financialDefinitions', () => {
  it('UT-001 parseMonth returns the month and its exclusive upper bound', () => {
    expect(parseMonth('2026-11', TODAY)).toEqual({
      year: 2026,
      month: 11,
      start: '2026-11-01',
      nextStart: '2026-12-01',
    });
  });

  it('UT-002 accepts the current month and the twelve before it, and rejects the thirteenth', () => {
    expect(parseMonth('2025-11', TODAY).start).toBe('2025-11-01');
    expect(invalidMonthOf('2025-10')).toMatchObject({
      status: 400,
      code: 'invalid_month',
    });
    expect(parseMonth(undefined, TODAY)).toMatchObject({
      year: 2026,
      month: 11,
    });
  });

  it('UT-003 rejects a future month', () => {
    expect(invalidMonthOf('2026-12')).toMatchObject({
      status: 400,
      code: 'invalid_month',
    });
  });

  it.each(['2026-13', '26-1', 'abc', '2026-00', '', '2026-1', '2026-11-01'])(
    'UT-004 rejects the malformed month %p',
    (raw) => {
      expect(invalidMonthOf(raw)).toMatchObject({
        status: 400,
        code: 'invalid_month',
      });
    },
  );

  it.each([
    [0, null],
    [-3, null],
    [1, 'D1_7'],
    [7, 'D1_7'],
    [8, 'D8_30'],
    [30, 'D8_30'],
    [31, 'D31_PLUS'],
    [400, 'D31_PLUS'],
  ])('UT-005 bandOf(%p) is %p', (days, band) => {
    expect(bandOf(days)).toBe(band);
  });

  it('UT-006 todayKey flips to the next day at 03:00 UTC (Brasília midnight)', () => {
    expect(todayKey(new Date('2026-11-17T02:59:59Z'))).toBe('2026-11-16');
    expect(todayKey(new Date('2026-11-17T03:00:00Z'))).toBe('2026-11-17');
  });

  it('UT-007 crosses the year boundary in both directions', () => {
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(previousMonth('2026-11')).toBe('2026-10');
    expect(parseMonth('2026-12', '2026-12-05').nextStart).toBe('2027-01-01');
  });

  it('UT-008 changeVsPrevious is a whole percentage, null without a usable base', () => {
    expect(changeVsPrevious(12000, 10000)).toBe(20);
    expect(changeVsPrevious(5000, 10000)).toBe(-50);
    expect(changeVsPrevious(100, 0)).toBeNull();
    expect(changeVsPrevious(100, null)).toBeNull();
  });

  it.each([
    [InvoiceStatus.PENDING, '2026-11-16', true],
    [InvoiceStatus.OVERDUE, '2026-11-17', false],
    [InvoiceStatus.PENDING, '2026-11-18', false],
    [InvoiceStatus.PAID, '2026-11-01', false],
    [InvoiceStatus.PAID_MANUALLY, '2026-11-01', false],
    [InvoiceStatus.CANCELED, '2026-11-01', false],
    [InvoiceStatus.OVERDUE, '2026-10-01', true],
  ])('UT-009 isOverdue(%s due %s) is %p', (status, dueDate, expected) => {
    expect(isOverdue({ status, dueDate }, TODAY)).toBe(expected);
  });
});

describe('requestedPage and resolvePage', () => {
  it.each([
    ['3', 3],
    ['0', 1],
    ['-2', 1],
    ['abc', 1],
    ['1.5', 1],
    [undefined, 1],
    ['99999999999999999999', 1_000_000],
  ])('requestedPage(%s) is %s', (raw, expected) => {
    expect(requestedPage(raw)).toBe(expected);
  });

  it('resolvePage clamps a page past the end to the last page that exists', () => {
    expect(resolvePage('9', 45)).toBe(3);
    expect(resolvePage('2', 45)).toBe(2);
    expect(resolvePage('9', 0)).toBe(1);
  });
});
