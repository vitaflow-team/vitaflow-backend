import type { MonthTotalsDTO } from '@/financial-health/dto/monthTotals.Dto';
import type { PlatformAccountTotalsDTO } from './platformAccountTotals.Dto';
import type { PlatformOverdueDTO } from './platformOverdue.Dto';
import type { PlatformPreviousMonthDTO } from './platformPreviousMonth.Dto';

// `available: false` means the month precedes the first stored payment: the
// month figures are then null (never zero) while `overdue` still shows today.
// `previous` is null when there is no usable comparison base.
export interface PlatformSummaryResponseDTO {
  month: string;
  available: boolean;
  syncedAt: string | null;
  totals: MonthTotalsDTO | null;
  byAccountType: PlatformAccountTotalsDTO | null;
  previous: PlatformPreviousMonthDTO | null;
  overdue: PlatformOverdueDTO;
}
