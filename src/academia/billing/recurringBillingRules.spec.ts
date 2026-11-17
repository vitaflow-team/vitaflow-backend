import { CodedError } from '@/common/errors/codedError';
import {
  defaultDueDay,
  dueDateOf,
  effectiveAmountCents,
  firstDueDate,
  firstFeeOf,
  nextCompetence,
  parseAmountCents,
  parseDueDay,
  priceToCents,
} from './recurringBillingRules';

function codeOf(run: () => unknown): { status: number; code: string } {
  try {
    run();
  } catch (error) {
    const coded = error as CodedError;
    return { status: coded.getStatus(), code: coded.code };
  }
  throw new Error('expected the call to throw');
}

describe('recurring billing rules', () => {
  it.each([
    [17, '2026-11-17'],
    [10, '2026-12-10'],
    [20, '2026-11-20'],
    [1, '2026-12-01'],
    [28, '2026-11-28'],
  ])(
    'UT-039 first due date for due day %i on 2026-11-17 is %s',
    (dueDay, expected) => {
      expect(firstDueDate(dueDay, '2026-11-17')).toBe(expected);
    },
  );

  it('UT-039 a due day already past in December rolls into January of the next year', () => {
    expect(firstDueDate(5, '2026-12-17')).toBe('2027-01-05');
  });

  it('UT-039 the first fee carries the competence of its due date', () => {
    expect(firstFeeOf(10, '2026-11-17')).toEqual({
      competence: { year: 2026, month: 12 },
      dueDate: '2026-12-10',
    });
  });

  it('UT-040 the default due day is today’s day, capped at 28', () => {
    expect(defaultDueDay('2026-10-31')).toBe(28);
    expect(defaultDueDay('2026-11-17')).toBe(17);
    expect(defaultDueDay('2026-11-28')).toBe(28);
    expect(defaultDueDay('2026-02-01')).toBe(1);
  });

  it.each([0, 29, 31, 1.5, '5x', '5', null, -1, Number.NaN])(
    'UT-041 due day %p is refused with invalid_due_day',
    (raw) => {
      expect(codeOf(() => parseDueDay(raw))).toEqual({
        status: 400,
        code: 'invalid_due_day',
      });
    },
  );

  it('UT-041 due days 1 and 28 are accepted', () => {
    expect(parseDueDay(1)).toBe(1);
    expect(parseDueDay(28)).toBe(28);
  });

  it.each([499, 0, -100, 5_000_001, 1.5, '1000', null])(
    'UT-042 amount %p is refused with invalid_amount',
    (raw) => {
      expect(codeOf(() => parseAmountCents(raw))).toEqual({
        status: 400,
        code: 'invalid_amount',
      });
    },
  );

  it('UT-042 amounts 500 and 5000000 are accepted', () => {
    expect(parseAmountCents(500)).toBe(500);
    expect(parseAmountCents(5_000_000)).toBe(5_000_000);
  });

  it('turns a catalog price in reais into whole cents', () => {
    expect(priceToCents(149.9)).toBe(14990);
    expect(priceToCents('249.90')).toBe(24990);
    expect(priceToCents(0)).toBe(0);
  });

  it('builds due dates and the month after December', () => {
    expect(dueDateOf({ year: 2027, month: 2 }, 28)).toBe('2027-02-28');
    expect(nextCompetence({ year: 2026, month: 12 })).toEqual({
      year: 2027,
      month: 1,
    });
  });

  describe('effectiveAmountCents (UT-058)', () => {
    it('UT-058 a non-custom amount follows the current catalog price', () => {
      expect(
        effectiveAmountCents(
          { amountCents: 14990, customAmount: false },
          15990,
        ),
      ).toBe(15990);
    });

    it('UT-058 a custom amount is never changed by the catalog', () => {
      expect(
        effectiveAmountCents({ amountCents: 12000, customAmount: true }, 15990),
      ).toBe(12000);
    });

    it.each([[null], [0], [100], [5_000_001]])(
      'a catalog price of %p that cannot be charged falls back to the stored amount',
      (price) => {
        expect(
          effectiveAmountCents(
            { amountCents: 14990, customAmount: false },
            price,
          ),
        ).toBe(14990);
      },
    );
  });
});
