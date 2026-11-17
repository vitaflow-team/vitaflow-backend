import type { GymRecurringBilling } from '@prisma/client';
import type { RecurringBillingResponseDTO } from './dto/recurringBillingResponse.Dto';

export function toBillingView(
  billing: GymRecurringBilling,
): RecurringBillingResponseDTO {
  return {
    clientId: billing.clientId,
    accessPlanId: billing.accessPlanId,
    dueDay: billing.dueDay,
    amountCents: billing.amountCents,
    customAmount: billing.customAmount,
    status: billing.status,
    startedAt: billing.startedAt.toISOString(),
  };
}
