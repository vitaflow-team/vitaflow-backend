import type { MonthRange } from '@/financial-health/types/monthRange';

export interface PlatformSummaryQuery {
  current: MonthRange;
  previous: MonthRange;
  today: string;
}
