import type { BillingOwner } from '@/billing/owner/types/billingOwner';

export interface UnlinkInput {
  owner: BillingOwner;
  clientId: string;
}
