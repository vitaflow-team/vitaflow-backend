import { ProductType } from '@prisma/client';
import {
  computeLtvBySegment,
  type ActivePremiumUserRow,
} from './ltvBySegment.util';

function activeRow(
  overrides: Partial<ActivePremiumUserRow> = {},
): ActivePremiumUserRow {
  return {
    productType: ProductType.USER,
    price: 100,
    canceledThisMonth: false,
    ...overrides,
  };
}

describe('computeLtvBySegment', () => {
  // UT-009
  it('computes LTV as ARPU divided by the monthly churn rate', () => {
    const rows = [
      ...new Array(19).fill(null).map(() => activeRow({ price: 100 })),
      activeRow({ price: 100, canceledThisMonth: true }),
    ];

    const result = computeLtvBySegment(rows, [ProductType.USER]);

    expect(result).toEqual([{ role: ProductType.USER, ltv: 2000 }]);
  });

  // UT-010
  it('returns ltv: null when the segment has zero cancellations this month', () => {
    const rows = [activeRow(), activeRow(), activeRow()];

    const result = computeLtvBySegment(rows, [ProductType.USER]);

    expect(result).toEqual([{ role: ProductType.USER, ltv: null }]);
  });

  // UT-011
  it('includes a role with ltv: null when it offers Premium but has zero active users', () => {
    const result = computeLtvBySegment([], [ProductType.NUTRITIONIST]);

    expect(result).toEqual([{ role: ProductType.NUTRITIONIST, ltv: null }]);
  });

  // UT-012
  it('omits a role entirely when it is absent from rolesWithPremiumOffering', () => {
    const rows = [activeRow({ productType: ProductType.ACADEMIA })];

    const result = computeLtvBySegment(rows, [ProductType.USER]);

    expect(result).toEqual([{ role: ProductType.USER, ltv: null }]);
    expect(
      result.find((entry) => entry.role === ProductType.ACADEMIA),
    ).toBeUndefined();
  });

  // UT-015
  it('has no Free-tier handling branch — only ever receives Premium rows', () => {
    const rows = [
      activeRow({ price: 50 }),
      activeRow({ price: 150, canceledThisMonth: true }),
    ];

    const result = computeLtvBySegment(rows, [ProductType.USER]);

    // ARPU = (50 + 150) / 2 = 100; churnRate = 1/2 = 0.5; ltv = 200
    expect(result).toEqual([{ role: ProductType.USER, ltv: 200 }]);
  });
});
