// A calendar month as the panels query it: both bounds are Brasília calendar
// dates (YYYY-MM-DD), `nextStart` exclusive.
export interface MonthRange {
  year: number;
  month: number;
  start: string;
  nextStart: string;
}
