export const BILLING_LIMITS = {
  amountMinCents: 500,
  amountMaxCents: 5_000_000,
  dueDateMaxDaysAhead: 90,
  competenceMonthsWindow: 12,
  manualNoteMaxLength: 200,
  apiKeyMinLength: 10,
  apiKeyMaxLength: 200,
  invoicePageSize: 20,
  resendIntervalMinutes: 60,
  orphanReservationGraceMinutes: 10,
} as const;
