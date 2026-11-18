import type { BillingOwnerKind } from './billingOwnerKind';

// Who bills: an independent professional or the owner of a gym. `ownerId` is
// the Users.id that owns the BillingAccount rows (ADR-008).
export interface BillingOwner {
  ownerId: string;
  kind: BillingOwnerKind;
  academiaId: string | null;
}
