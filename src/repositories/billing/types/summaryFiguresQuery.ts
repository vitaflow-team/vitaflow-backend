import type { MonthRange } from '@/financial-health/types/monthRange';

export interface SummaryFiguresQuery {
  ownerId: string;
  current: MonthRange;
  previous: MonthRange;
  today: string;
}
