import { canBill } from '@/billing/shared/premiumAccess';
import { Injectable } from '@nestjs/common';
import { ownsClient, resolveBillingOwner } from './billingOwnerRules';
import type { BillingOwner } from './types/billingOwner';
import type { BillingSubject } from './types/billingSubject';
import type { ClientScope } from './types/clientScope';

// Entry point for "who is billing" (ADR-008). The rules themselves are pure
// functions, so services that already hold the facts can use them directly.
@Injectable()
export class BillingOwnerService {
  resolve(user: BillingSubject): BillingOwner {
    return resolveBillingOwner(user);
  }

  canBill(user: BillingSubject | null): boolean {
    return canBill(user);
  }

  ownsClient(owner: BillingOwner, client: ClientScope): boolean {
    return ownsClient(owner, client);
  }
}
