import type { BillingOwner } from '@/billing/owner/types/billingOwner';
import type { AcademiaOwnerRequest } from '@/common/types/academiaOwnerRequest';

// The billing owner behind a request that passed AcademiaOwnerGuard: the gym
// owner, who bills its own students.
export function gymOwnerOf(req: AcademiaOwnerRequest): BillingOwner {
  return {
    ownerId: req.user.id,
    kind: 'GYM',
    academiaId: req.user.academiaId,
  };
}
