import type { BillingState } from '../types/billingState';
import type { PanelAudience } from '../types/panelAudience';
import type { MonthTotalsDTO } from './monthTotals.Dto';
import type { OverdueSummaryDTO } from './overdueSummary.Dto';

export interface FinancialSummaryResponseDTO {
  audience: PanelAudience;
  billingState: BillingState;
  hasHistory: boolean;
  month: string;
  current: MonthTotalsDTO;
  previous: MonthTotalsDTO;
  overdue: OverdueSummaryDTO;
}
