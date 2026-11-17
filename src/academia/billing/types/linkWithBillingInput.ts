import type { BillingOwner } from '@/billing/owner/types/billingOwner';
import type { BillingTermsInput } from './billingTermsInput';

export interface LinkWithBillingInput {
  owner: BillingOwner;
  clientId: string;
  accessPlanId: string;
  billing: BillingTermsInput;
}
