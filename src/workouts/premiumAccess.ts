import { PAID_STATUSES } from '@/users/subscription/subscriptionExpiry';

// Isolated on purpose (ADR-002, TechSpec Known Risks): the Progress Photos
// feature is expected to later extract this into a shared `PremiumGuard`.
// Reuses the same "paid" definition `subscriptionExpiry.ts` already uses
// (active/trialing/past_due + a non-zero-price plan) rather than inventing
// a second one.
export interface PremiumCheckInput {
  subscriptionStatus: string | null;
  productPrice: number | null;
}

export function isPremiumUser(input: PremiumCheckInput): boolean {
  return (
    input.subscriptionStatus !== null &&
    PAID_STATUSES.includes(input.subscriptionStatus) &&
    (input.productPrice ?? 0) > 0
  );
}
