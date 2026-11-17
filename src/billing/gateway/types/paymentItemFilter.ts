// Selects one page of a payment listing. Without `dueFrom`/`dueTo` the whole
// history is listed; both bounds are inclusive calendar dates (YYYY-MM-DD).
export interface PaymentItemFilter {
  dueFrom?: string;
  dueTo?: string;
  offset: number;
}
