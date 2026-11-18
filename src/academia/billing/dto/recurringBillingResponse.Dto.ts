import type { RecurringBillingStatus } from '@prisma/client';

export interface RecurringBillingResponseDTO {
  clientId: string;
  accessPlanId: string;
  dueDay: number;
  amountCents: number;
  customAmount: boolean;
  status: RecurringBillingStatus;
  startedAt: string;
}
