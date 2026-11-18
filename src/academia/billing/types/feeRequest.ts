import type { IssuableBilling } from '@/repositories/academia/types/issuableBilling';
import type { BillingAccount } from '@prisma/client';
import type { PlannedFee } from './plannedFee';
import type { RunContext } from './runContext';

export interface FeeRequest {
  item: IssuableBilling;
  account: BillingAccount;
  fee: PlannedFee;
  context: RunContext;
}
