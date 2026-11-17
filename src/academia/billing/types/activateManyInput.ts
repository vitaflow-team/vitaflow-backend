import type { BillingOwner } from '@/billing/owner/types/billingOwner';
import type { ActivationItem } from './activationItem';

export interface ActivateManyInput {
  owner: BillingOwner;
  items: ActivationItem[];
}
