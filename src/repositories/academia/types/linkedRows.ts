import type { GymRecurringBilling, StudentAccessPlan } from '@prisma/client';

// What a link created, plus the plan it displaced: enough to undo it.
export interface LinkedRows {
  plan: StudentAccessPlan;
  billing: GymRecurringBilling;
  previousPlanId: string | null;
}
