// Fixed rules of the gym's recurring monthly billing (financial-health
// ADR-007). Code constants rather than environment values, like
// BILLING_LIMITS.
export const RECURRING_BILLING_LIMITS = {
  issueLeadDays: 10,
  catchUpMaxMonths: 3,
  bulkActivationMaxItems: 200,
  dueDayMin: 1,
  dueDayMax: 28,
} as const;
