export type GatewayErrorKind =
  | 'auth'
  | 'validation'
  | 'not_found'
  | 'unavailable';

export class GatewayError extends Error {
  constructor(
    public readonly kind: GatewayErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export type GatewayChargeStatus =
  | 'PAID'
  | 'OVERDUE'
  | 'PENDING'
  | 'CANCELED'
  | 'UNHANDLED';

export interface GatewayCharge {
  externalId: string;
  status: GatewayChargeStatus;
  rawStatus: string;
  valueCents: number;
  dueDate: string;
  paymentDate: string | null;
}

export interface CustomerInput {
  name: string;
  cpfCnpj: string;
  email: string;
  externalReference: string;
}

export interface ChargeInput {
  customerExternalId: string;
  amountCents: number;
  dueDate: string;
  description: string;
  externalReference: string;
}

// Platform subscription billing (ADR-010) — Asaas Checkout (`assinaturas`),
// a different endpoint family from the `cobranças` one-off charges above,
// but the same gateway/credential-agnostic shape: every method still takes
// the caller's own `apiKey`, so one `AsaasGateway` instance serves both the
// per-professional invoice flow and the platform's own subscriptions.
export interface SubscriptionCheckoutInput {
  successUrl: string;
  cancelUrl: string;
  itemName: string;
  valueCents: number;
  /** YYYY-MM-DD — the first charge's due date. */
  nextDueDate: string;
  externalReference: string;
}

export interface SubscriptionChanges {
  valueCents?: number;
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface PaymentGateway {
  verifyAccount(apiKey: string): Promise<{ accountName: string }>;
  registerWebhook(
    apiKey: string,
    url: string,
    token: string,
  ): Promise<{ webhookId: string }>;
  removeWebhook(apiKey: string, webhookId: string): Promise<void>;
  ensureCustomer(
    apiKey: string,
    customer: CustomerInput,
  ): Promise<{ externalId: string }>;
  createCharge(
    apiKey: string,
    charge: ChargeInput,
  ): Promise<{ externalId: string; paymentUrl: string }>;
  getCharge(apiKey: string, externalId: string): Promise<GatewayCharge>;
  updateCharge(
    apiKey: string,
    externalId: string,
    changes: { amountCents?: number; dueDate?: string },
  ): Promise<void>;
  cancelCharge(apiKey: string, externalId: string): Promise<void>;
  createSubscriptionCheckout(
    apiKey: string,
    input: SubscriptionCheckoutInput,
  ): Promise<{ checkoutId: string; link: string }>;
  updateSubscription(
    apiKey: string,
    subscriptionId: string,
    changes: SubscriptionChanges,
  ): Promise<void>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
