import type { ProductTier, ProductType } from '@prisma/client';

// The slice of a user (with its plan) the billing rules read. A Users row
// joined with its product satisfies it.
export interface BillingSubject {
  id: string;
  academiaId: string | null;
  subscriptionStatus: string | null;
  product: { type: ProductType; tier: ProductTier } | null;
}
