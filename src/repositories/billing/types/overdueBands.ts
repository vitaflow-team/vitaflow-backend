// Overdue amounts per aging band and the number of people behind them.
// Always the current situation, whatever month the panel shows.
export interface OverdueBands {
  d1to7Cents: number;
  d8to30Cents: number;
  d31PlusCents: number;
  delinquentCount: number;
}
