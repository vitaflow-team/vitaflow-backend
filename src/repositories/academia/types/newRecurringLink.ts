import type { StudentAccessPlanData } from '../studentAccessPlan.repository';
import type { NewRecurringBillingData } from './newRecurringBillingData';

// A plan assignment together with the recurring billing that goes with it
// (ADR-007): created in one transaction.
export interface NewRecurringLink {
  plan: StudentAccessPlanData;
  billing: NewRecurringBillingData;
}
