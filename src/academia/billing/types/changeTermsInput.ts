import type { BillingOwner } from '@/billing/owner/types/billingOwner';

export interface ChangeTermsInput {
  owner: BillingOwner;
  clientId: string;
  dueDay?: unknown;
  amountCents?: unknown;
}
