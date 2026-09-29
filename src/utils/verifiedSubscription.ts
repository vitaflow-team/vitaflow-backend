// What Stripe itself reports for a subscription a caller claims to own.
export interface VerifiedSubscription {
  status: string;
  priceId: string | null;
  customerId: string;
  belongsToUser: boolean;
}
