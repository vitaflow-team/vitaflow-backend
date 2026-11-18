import type { Competence } from '@/billing/shared/types/competence';
import type { BillingAccount, Client } from '@prisma/client';

// One gym fee to issue: the owner's already-validated account, the student,
// the recurring row it belongs to and the fee's own terms.
export interface RecurringFeeInput {
  account: BillingAccount;
  client: Client;
  recurringBillingId: string;
  competence: Competence;
  amountCents: number;
  dueDate: string;
}
