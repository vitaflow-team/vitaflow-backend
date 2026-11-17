// One delinquent person: only their overdue invoices count (ADR-004).
export interface DelinquentRow {
  clientId: string;
  name: string;
  totalOwedCents: number;
  overdueCount: number;
  oldestDaysOverdue: number;
}
