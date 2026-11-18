import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import type { BillingOwner } from './billingOwner';

// A request that has passed BillingOwnerGuard.
export type BillingOwnerRequest = AuthenticatedRequest & {
  billingOwner: BillingOwner;
};
