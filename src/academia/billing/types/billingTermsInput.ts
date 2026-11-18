// The fee terms of a link, exactly as received: validated by the service so
// each failure carries its own code, not by the DTO's generic 400.
export interface BillingTermsInput {
  dueDay?: unknown;
  amountCents?: unknown;
  cpfCnpj?: string;
}
