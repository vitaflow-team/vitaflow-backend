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
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
