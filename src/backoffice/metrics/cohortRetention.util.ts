import { lastNMonthStarts, startOfMonth } from '@/utils/monthRange';
import { ProductTier, ProductType } from '@prisma/client';

export const COHORT_WINDOW_MONTHS = 12;

export type CohortPlan = 'FREE' | 'PREMIUM';

export interface CohortUserRow {
  cohortMonthStart: Date;
  subscriptionCancelAt: Date | null;
  productType: ProductType;
  tier: ProductTier;
}

export interface CohortRetentionRow {
  cohortMonth: string; // "yyyy-MM", UTC
  role: ProductType;
  plan: CohortPlan;
  cohortSize: number;
  // index = months since signup; null = not yet elapsed, never 0
  retainedPercentByMonth: (number | null)[];
}

interface MutableRow {
  cohortSize: number;
  retainedCountByMonth: number[];
}

interface RetentionContext {
  grid: Map<string, MutableRow>;
  now: Date;
  monthsBack: number;
}

interface Segment {
  role: ProductType;
  plan: CohortPlan;
}

function cohortMonthKey(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}`;
}

function planOf(tier: ProductTier): CohortPlan {
  return tier === ProductTier.FREE ? 'FREE' : 'PREMIUM';
}

function allSegments(): Segment[] {
  return Object.values(ProductType).flatMap((role) =>
    (['FREE', 'PREMIUM'] as CohortPlan[]).map((plan) => ({ role, plan })),
  );
}

function gridKey(cohortMonthStart: Date, segment: Segment): string {
  return `${cohortMonthKey(cohortMonthStart)}|${segment.role}|${segment.plan}`;
}

// Months elapsed between a cohort's signup month and `now` (cohort-ltv-analysis).
function elapsedMonths(cohortMonthStart: Date, now: Date): number {
  const nowMonthStart = startOfMonth(now);
  return (
    (nowMonthStart.getUTCFullYear() - cohortMonthStart.getUTCFullYear()) * 12 +
    (nowMonthStart.getUTCMonth() - cohortMonthStart.getUTCMonth())
  );
}

// Retained in elapsed month `k` means the account still exists and
// subscriptionCancelAt had not fallen on or before that month's end
// (cohort-ltv-analysis ADR-003 — tracks account/subscription survival,
// never activity, since no activity tracking exists).
function retainedThroughMonth(
  row: CohortUserRow,
  elapsedMonth: number,
): boolean {
  if (!row.subscriptionCancelAt) return true;
  const monthEnd = new Date(
    Date.UTC(
      row.cohortMonthStart.getUTCFullYear(),
      row.cohortMonthStart.getUTCMonth() + elapsedMonth + 1,
      1,
    ),
  );
  return row.subscriptionCancelAt >= monthEnd;
}

// Zero-fills every (cohortMonth, role, plan) combination up front, so a
// combination with no matching users still appears with cohortSize: 0 rather
// than being silently omitted (cohort-ltv-analysis ADR-007's zero-cell
// guarantee, by different means than the existing per-cell count() style).
function initializeGrid(
  cohortMonths: Date[],
  monthsBack: number,
): Map<string, MutableRow> {
  const grid = new Map<string, MutableRow>();
  for (const cohortMonthStart of cohortMonths) {
    for (const segment of allSegments()) {
      grid.set(gridKey(cohortMonthStart, segment), {
        cohortSize: 0,
        retainedCountByMonth: new Array(monthsBack).fill(0),
      });
    }
  }
  return grid;
}

function bucketRow(ctx: RetentionContext, row: CohortUserRow): void {
  const segment: Segment = { role: row.productType, plan: planOf(row.tier) };
  const cell = ctx.grid.get(gridKey(row.cohortMonthStart, segment));
  if (!cell) return; // outside the tracked window

  cell.cohortSize += 1;
  const elapsed = elapsedMonths(row.cohortMonthStart, ctx.now);
  for (let month = 0; month <= Math.min(elapsed, ctx.monthsBack - 1); month++) {
    if (retainedThroughMonth(row, month)) {
      cell.retainedCountByMonth[month] += 1;
    }
  }
}

function toPercentages(
  cell: MutableRow,
  elapsed: number,
  monthsBack: number,
): (number | null)[] {
  return Array.from({ length: monthsBack }, (_, month) => {
    if (month > elapsed) return null; // not yet elapsed — never 0
    if (cell.cohortSize === 0) return 0; // explicit zero, never omitted
    return (cell.retainedCountByMonth[month] / cell.cohortSize) * 100;
  });
}

function buildRow(
  ctx: RetentionContext,
  cohortMonthStart: Date,
  segment: Segment,
): CohortRetentionRow {
  const cell = ctx.grid.get(gridKey(cohortMonthStart, segment))!;
  const elapsed = elapsedMonths(cohortMonthStart, ctx.now);
  return {
    cohortMonth: cohortMonthKey(cohortMonthStart),
    role: segment.role,
    plan: segment.plan,
    cohortSize: cell.cohortSize,
    retainedPercentByMonth: toPercentages(cell, elapsed, ctx.monthsBack),
  };
}

export function computeCohortRetention(
  rows: CohortUserRow[],
  now: Date,
  monthsBack: number = COHORT_WINDOW_MONTHS,
): CohortRetentionRow[] {
  const cohortMonths = lastNMonthStarts(now, monthsBack);
  const ctx: RetentionContext = {
    grid: initializeGrid(cohortMonths, monthsBack),
    now,
    monthsBack,
  };

  for (const row of rows) {
    bucketRow(ctx, row);
  }

  return cohortMonths.flatMap((cohortMonthStart) =>
    allSegments().map((segment) => buildRow(ctx, cohortMonthStart, segment)),
  );
}
