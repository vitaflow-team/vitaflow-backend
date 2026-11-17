import type { MonthTotalsDTO } from '@/financial-health/dto/monthTotals.Dto';
import type { OverdueSummaryDTO } from '@/financial-health/dto/overdueSummary.Dto';
import type { MonthTotals } from '@/repositories/billing/types/monthTotals';
import type { OverdueBands } from '@/repositories/billing/types/overdueBands';
import type { PlatformFigures } from '@/repositories/billing/types/platformFigures';
import { ProductType } from '@prisma/client';
import type { PlatformAccountTotalsDTO } from './dto/platformAccountTotals.Dto';
import type { PlatformOverdueDTO } from './dto/platformOverdue.Dto';

function perAccountType<T>(
  pick: (type: ProductType) => T,
): Record<ProductType, T> {
  return Object.fromEntries(
    Object.values(ProductType).map((type) => [type, pick(type)]),
  ) as Record<ProductType, T>;
}

export function totalsOf(totals: MonthTotals): MonthTotalsDTO {
  return {
    expectedCents: totals.expectedCents,
    receivedCents: totals.receivedCents,
    stillOwedCents: totals.stillOwedCents,
  };
}

export function accountTotalsOf(
  byType: Record<ProductType, PlatformFigures>,
  which: 'current' | 'previous',
): PlatformAccountTotalsDTO {
  return perAccountType((type) => totalsOf(byType[type][which]));
}

function overdueSummaryOf(overdue: OverdueBands): OverdueSummaryDTO {
  return {
    totalCents: overdue.d1to7Cents + overdue.d8to30Cents + overdue.d31PlusCents,
    delinquentCount: overdue.delinquentCount,
    bands: {
      d1to7Cents: overdue.d1to7Cents,
      d8to30Cents: overdue.d8to30Cents,
      d31PlusCents: overdue.d31PlusCents,
    },
  };
}

export function platformOverdueOf(
  total: PlatformFigures,
  byType: Record<ProductType, PlatformFigures>,
): PlatformOverdueDTO {
  return {
    ...overdueSummaryOf(total.overdue),
    byAccountType: perAccountType((type) =>
      overdueSummaryOf(byType[type].overdue),
    ),
  };
}
