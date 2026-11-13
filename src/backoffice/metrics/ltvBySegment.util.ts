import { ProductType } from '@prisma/client';

export interface ActivePremiumUserRow {
  productType: ProductType;
  price: number;
  canceledThisMonth: boolean;
}

export interface LtvBySegmentEntry {
  role: ProductType;
  ltv: number | null; // null = not enough data (zero churn or zero Premium users)
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// ARPU ÷ monthly churn rate (cohort-ltv-analysis ADR-001, projected not
// realized). A zero churn rate or an empty segment both mean "not enough
// data" (US-002.EC-1/EC-2), never a divide-by-zero or a misleadingly
// literal zero.
function ltvForSegment(rows: ActivePremiumUserRow[]): number | null {
  if (rows.length === 0) return null;

  const canceled = rows.filter((row) => row.canceledThisMonth).length;
  const churnRate = canceled / rows.length;
  if (churnRate === 0) return null;

  const arpu = mean(rows.map((row) => row.price));
  return arpu / churnRate;
}

// Only emits one entry per role present in `rolesWithPremiumOffering` — a
// role with no active Premium product at all is omitted entirely
// (US-002.EC-3), distinct from a role that offers Premium but currently has
// zero active subscribers (ltv: null, US-002.EC-2).
export function computeLtvBySegment(
  rows: ActivePremiumUserRow[],
  rolesWithPremiumOffering: ProductType[],
): LtvBySegmentEntry[] {
  return rolesWithPremiumOffering.map((role) => ({
    role,
    ltv: ltvForSegment(rows.filter((row) => row.productType === role)),
  }));
}
