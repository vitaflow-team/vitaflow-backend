export interface DelinquentRowDTO {
  clientId: string;
  name: string;
  totalOwedCents: number;
  overdueCount: number;
  oldestDaysOverdue: number;
}
