// What the platform subscription webhook hands to `syncFromGateway`, once
// it has resolved the event into Vita Flow's own vocabulary. Not a
// class-validator DTO: never bound to a request body, only built
// in-process by `SubscriptionWebhookService` from an Asaas event payload.
export interface AsaasSyncInput {
  asaasCustomerId: string;
  /**
   * Omitted (undefined) means the event didn't carry one yet (e.g.
   * CHECKOUT_PAID, before Asaas has created the subscription) — the stored
   * value is left untouched. Explicit null means the subscription ended
   * (SUBSCRIPTION_DELETED) and clears it.
   */
  asaasSubscriptionId?: string | null;
  /** Only present the first time a customer is linked (CHECKOUT_PAID's `externalReference`). */
  userId?: string;
  /** Only present on first link — which product the checkout was for. */
  productId?: string;
  subscriptionStatus: string;
  subscriptionCancelAt?: string | null;
  subscriptionCurrentPeriodEnd?: string | null;
}
