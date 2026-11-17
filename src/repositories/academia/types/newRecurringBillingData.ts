export interface NewRecurringBillingData {
  clientId: string;
  accessPlanId: string;
  dueDay: number;
  amountCents: number;
  customAmount: boolean;
}
