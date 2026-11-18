import type { MonthTotals } from './monthTotals';
import type { OverdueBands } from './overdueBands';

// Everything the summary needs, read in one statement so the figures come
// from one consistent snapshot.
export interface SummaryFigures {
  current: MonthTotals;
  previous: MonthTotals;
  overdue: OverdueBands;
}
