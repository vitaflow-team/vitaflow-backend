import type { BillingOwner } from '@/billing/owner/types/billingOwner';
import type { BillingAccount } from '@prisma/client';

export interface ActivationContext {
  owner: BillingOwner;
  account: BillingAccount;
  today: string;
}
