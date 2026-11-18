import type { MonthTotalsDTO } from '@/financial-health/dto/monthTotals.Dto';
import type { PlatformAccountTotalsDTO } from './platformAccountTotals.Dto';

// The comparison base: the month before the selected one.
export interface PlatformPreviousMonthDTO {
  month: string;
  totals: MonthTotalsDTO;
  byAccountType: PlatformAccountTotalsDTO;
}
