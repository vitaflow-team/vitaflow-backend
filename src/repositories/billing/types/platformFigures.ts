import type { MonthTotals } from './monthTotals';
import type { OverdueBands } from './overdueBands';

// The figures of one slice of the platform's payments (everything, or one
// account type): the selected month, the month before it, and today's overdue.
export interface PlatformFigures {
  current: MonthTotals;
  previous: MonthTotals;
  overdue: OverdueBands;
}
