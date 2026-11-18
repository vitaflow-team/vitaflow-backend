import type { BillingAccount } from '@prisma/client';
import type { IssuerSkipReason } from './issuerSkipReason';

// Whether an owner's rows may be issued tonight: with the account to charge
// through, or the reason they are all skipped.
export type OwnerGate =
  | { account: BillingAccount }
  | {
      skip: Extract<
        IssuerSkipReason,
        'account_unavailable' | 'subscription_inactive'
      >;
    };
