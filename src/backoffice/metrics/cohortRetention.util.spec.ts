import { ProductTier, ProductType } from '@prisma/client';
import {
  computeCohortRetention,
  type CohortUserRow,
} from './cohortRetention.util';

const NOW = new Date('2026-03-15T00:00:00Z');

function row(overrides: Partial<CohortUserRow> = {}): CohortUserRow {
  return {
    cohortMonthStart: new Date('2025-12-01T00:00:00Z'), // 3 months before NOW
    subscriptionCancelAt: null,
    productType: ProductType.USER,
    tier: ProductTier.FREE,
    ...overrides,
  };
}

function findRow(
  rows: ReturnType<typeof computeCohortRetention>,
  cohortMonth: string,
  role: ProductType,
  plan: 'FREE' | 'PREMIUM',
) {
  const found = rows.find(
    (r) => r.cohortMonth === cohortMonth && r.role === role && r.plan === plan,
  );
  if (!found) throw new Error(`row not found: ${cohortMonth} ${role} ${plan}`);
  return found;
}

describe('computeCohortRetention', () => {
  // UT-004
  it('counts a never-canceled Free USER row as retained through every elapsed month', () => {
    const result = computeCohortRetention([row()], NOW);

    const target = findRow(result, '2025-12', ProductType.USER, 'FREE');
    expect(target.cohortSize).toBe(1);
    expect(target.retainedPercentByMonth.slice(0, 4)).toEqual([
      100, 100, 100, 100,
    ]);
    expect(target.retainedPercentByMonth.slice(4)).toEqual(
      new Array(8).fill(null),
    );
  });

  // UT-005
  it('shows an explicit zero, never a missing row, for a segment with no signups', () => {
    const result = computeCohortRetention([], NOW);

    const target = findRow(result, '2025-04', ProductType.ACADEMIA, 'PREMIUM');
    expect(target.cohortSize).toBe(0);
    expect(target.retainedPercentByMonth).toEqual(new Array(12).fill(0));
  });

  // UT-006
  it('drops retention from the elapsed month a cancellation falls in, onward', () => {
    const canceledRow = row({
      tier: ProductTier.PREMIUM,
      subscriptionCancelAt: new Date('2026-02-10T00:00:00Z'),
    });

    const result = computeCohortRetention([canceledRow], NOW);

    const target = findRow(result, '2025-12', ProductType.USER, 'PREMIUM');
    expect(target.retainedPercentByMonth.slice(0, 4)).toEqual([100, 100, 0, 0]);
  });

  // UT-007
  it('counts a reactivated (cleared) cancellation as retained again, with no cancellation history needed', () => {
    const reactivatedRow = row({ subscriptionCancelAt: null });

    const result = computeCohortRetention([reactivatedRow], NOW);

    const target = findRow(result, '2025-12', ProductType.USER, 'FREE');
    expect(target.retainedPercentByMonth.slice(0, 4)).toEqual([
      100, 100, 100, 100,
    ]);
  });

  // UT-008
  it('leaves future columns null, never 0, for a cohort still in its first month', () => {
    const currentMonthRow = row({
      cohortMonthStart: new Date('2026-03-01T00:00:00Z'),
    });

    const result = computeCohortRetention([currentMonthRow], NOW);

    const target = findRow(result, '2026-03', ProductType.USER, 'FREE');
    expect(target.retainedPercentByMonth[0]).toBe(100);
    expect(target.retainedPercentByMonth.slice(1)).toEqual(
      new Array(11).fill(null),
    );
  });

  // UT-013
  it('keeps two roles/plans in the same cohort month independently correct', () => {
    const rows = [
      row({ productType: ProductType.USER, tier: ProductTier.FREE }),
      row({ productType: ProductType.USER, tier: ProductTier.FREE }),
      row({ productType: ProductType.NUTRITIONIST, tier: ProductTier.PREMIUM }),
    ];

    const result = computeCohortRetention(rows, NOW);

    expect(
      findRow(result, '2025-12', ProductType.USER, 'FREE').cohortSize,
    ).toBe(2);
    expect(
      findRow(result, '2025-12', ProductType.NUTRITIONIST, 'PREMIUM')
        .cohortSize,
    ).toBe(1);
  });

  // UT-014
  it('includes exactly the 12th elapsed-month column for the oldest tracked cohort, never a 13th', () => {
    const oldestCohortRow = row({
      cohortMonthStart: new Date('2025-04-01T00:00:00Z'),
    });

    const result = computeCohortRetention([oldestCohortRow], NOW);

    const target = findRow(result, '2025-04', ProductType.USER, 'FREE');
    expect(target.retainedPercentByMonth).toHaveLength(12);
    expect(target.retainedPercentByMonth[11]).toBe(100);
  });
});
