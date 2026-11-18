import type { ProductType } from '@prisma/client';

// The minimum a delinquent row carries (ADR-005): never an individual payment.
export interface PlatformDelinquentRowDTO {
  userId: string;
  name: string;
  accountType: ProductType;
  planName: string;
  totalOwedCents: number;
  oldestDaysOverdue: number;
}
