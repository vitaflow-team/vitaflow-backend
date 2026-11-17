import { brasiliaDateKey } from '@/billing/shared/dates';
import { CodedError } from '@/common/errors/codedError';
import { InvoiceStatus } from '@prisma/client';
import type { AgingBand } from '../types/agingBand';
import type { MonthRange } from '../types/monthRange';
import type { OverdueCandidate } from '../types/overdueCandidate';

// How many months before the current one a panel may open (PRD rule 15).
export const MONTHS_BACK = 12;

// Rows per page of every delinquent list (PRD rule 14).
export const DELINQUENT_PAGE_SIZE = 20;

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const INVALID_MONTH = 'Mês inválido.';

const OPEN_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.PENDING,
  InvoiceStatus.OVERDUE,
];

// The Brasília calendar date of an instant. The only way the panels learn
// what "today" is; callers pass the injected Clock's instant.
export function todayKey(now: Date): string {
  return brasiliaDateKey(now);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

function toRange(year: number, month: number): MonthRange {
  const next =
    month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return {
    year,
    month,
    start: `${monthKey(year, month)}-01`,
    nextStart: `${monthKey(next.year, next.month)}-01`,
  };
}

function invalidMonth(): CodedError {
  return new CodedError(INVALID_MONTH, 400, 'invalid_month');
}

// Validates a `YYYY-MM` query value against today (Brasília): the current
// month and the twelve before it are accepted; absent means the current one.
export function parseMonth(raw: string | undefined, today: string): MonthRange {
  const current = MONTH_PATTERN.exec(today.slice(0, 7));
  const currentIndex = monthIndex(Number(current![1]), Number(current![2]));
  if (raw === undefined)
    return toRange(Number(current![1]), Number(current![2]));

  const match = MONTH_PATTERN.exec(raw);
  if (!match) throw invalidMonth();
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw invalidMonth();

  const distance = currentIndex - monthIndex(year, month);
  if (distance < 0 || distance > MONTHS_BACK) throw invalidMonth();
  return toRange(year, month);
}

// The range of a `YYYY-MM` key already known to be a real month (for example
// the month before a validated one, which may lie just outside the window).
export function monthRangeOf(key: string): MonthRange {
  const [year, month] = key.split('-').map(Number);
  return toRange(year, month);
}

// `YYYY-MM` of the month before `key`.
export function previousMonth(key: string): string {
  const match = MONTH_PATTERN.exec(key);
  if (!match) throw invalidMonth();
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month === 1 ? monthKey(year - 1, 12) : monthKey(year, month - 1);
}

// Aging bands (ADR-004): 1-7, 8-30 and 31+ days past the due date. An
// invoice due today is not overdue, so zero (or less) has no band.
export function bandOf(daysOverdue: number): AgingBand | null {
  if (daysOverdue < 1) return null;
  if (daysOverdue <= 7) return 'D1_7';
  if (daysOverdue <= 30) return 'D8_30';
  return 'D31_PLUS';
}

// Overdue is computed against today, never read from the status column the
// nightly job updates (ADR-004).
export function isOverdue(invoice: OverdueCandidate, today: string): boolean {
  return OPEN_STATUSES.includes(invoice.status) && invoice.dueDate < today;
}

// Percentage change against the previous month, rounded to a whole number;
// null when there is no usable base (zero or unavailable).
export function changeVsPrevious(
  current: number,
  previous: number | null,
): number | null {
  if (previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

// Far beyond any real list, and small enough to be stored in an integer column.
const MAX_PAGE = 1_000_000;

// The page a request asks for: anything that is not a positive whole number is
// page 1.
export function requestedPage(raw: unknown): number {
  const requested = Number(raw);
  return typeof raw === 'string' &&
    Number.isInteger(requested) &&
    requested >= 1
    ? Math.min(requested, MAX_PAGE)
    : 1;
}

// The page a list should return: a page past the end is the last page that
// exists.
export function resolvePage(raw: unknown, total: number): number {
  const lastPage = Math.max(1, Math.ceil(total / DELINQUENT_PAGE_SIZE));
  return Math.min(requestedPage(raw), lastPage);
}
