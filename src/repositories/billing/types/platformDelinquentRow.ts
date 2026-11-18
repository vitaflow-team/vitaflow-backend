import type { ProductType } from '@prisma/client';

// One delinquent user: only their overdue payments count (ADR-004). Account
// type and plan come from the snapshot on their oldest overdue payment.
export interface PlatformDelinquentRow {
  userId: string;
  name: string;
  accountType: ProductType;
  planName: string;
  totalOwedCents: number;
  oldestDaysOverdue: number;
}
