// The three figures of a calendar month (ADR-004), in integer cents.
export interface MonthTotals {
  expectedCents: number;
  receivedCents: number;
  stillOwedCents: number;
}
