// Single source of truth for "when does this plan end and will it renew"
// (ADR-004). Pure and side-effect free: every response that exposes
// `expiresAt`/`autoRenew` derives them here so no client ever computes an
// expiry from the raw Stripe mirror columns.

// The statuses the app already treats as an active subscription.
const PAID_STATUSES = ['active', 'trialing', 'past_due'];

export interface Expiry {
  expiresAt: Date | null;
  autoRenew: boolean;
}

export function deriveExpiry(input: {
  status: string | null;
  cancelAt: Date | null;
  periodEnd: Date | null;
  // Null where the caller has no product loaded (the server-to-server
  // subscription endpoint); only an explicit 0 marks Gratuito.
  planPrice: number | null;
}): Expiry {
  const { status, planPrice } = input;
  const cancelAt = input.cancelAt ?? null;
  const periodEnd = input.periodEnd ?? null;

  const paid =
    status !== null && PAID_STATUSES.includes(status) && planPrice !== 0;

  if (!paid) {
    return { expiresAt: null, autoRenew: false };
  }

  // A scheduled cancellation wins over the period end: that is the date the
  // access actually stops. With neither stored (older subscriptions) there
  // is simply no date to show, which is not an error.
  return {
    expiresAt: cancelAt ?? periodEnd,
    autoRenew: cancelAt === null,
  };
}
