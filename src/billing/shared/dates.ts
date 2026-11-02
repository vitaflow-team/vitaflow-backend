import { CodedError } from '@/common/errors/codedError';
import { BILLING_LIMITS } from './billingLimits';

const DAY_MS = 24 * 60 * 60 * 1000;
const BRASILIA_OFFSET_MS = -3 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// For a precise instant (e.g. `new Date()`, "right now") that needs
// localizing to the Brasília calendar date it falls on.
export function brasiliaDateKey(instant: Date): string {
  return new Date(instant.getTime() + BRASILIA_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

// For a `@db.Date` column (dueDate, paidAt): Prisma stores these as
// midnight UTC of the calendar date itself, with no time-of-day meaning to
// localize — applying brasiliaDateKey's offset here would shift the date
// back a day instead of round-tripping it.
export function dateOnlyKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseCalendarDate(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  const valid =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
  return valid ? value : null;
}

export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / DAY_MS);
}

export function validateDueDate(value: unknown, todayKey: string): string {
  const message = `A data de vencimento deve ser de hoje até ${BILLING_LIMITS.dueDateMaxDaysAhead} dias à frente.`;
  const key = parseCalendarDate(value);
  if (!key) throw new CodedError(message, 400, 'invoice_invalid');
  const days = daysBetween(todayKey, key);
  if (days < 0 || days > BILLING_LIMITS.dueDateMaxDaysAhead) {
    throw new CodedError(message, 400, 'invoice_invalid');
  }
  return key;
}

export function currentCompetence(todayKey: string): {
  year: number;
  month: number;
} {
  const [year, month] = todayKey.split('-').map(Number);
  return { year, month };
}

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export function validateCompetence(
  year: unknown,
  month: unknown,
  todayKey: string,
): { year: number; month: number } {
  const message = `A competência deve estar dentro de ${BILLING_LIMITS.competenceMonthsWindow} meses do mês atual.`;
  if (
    typeof year !== 'number' ||
    typeof month !== 'number' ||
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new CodedError(message, 400, 'invoice_invalid');
  }
  const current = currentCompetence(todayKey);
  const distance = Math.abs(
    monthIndex(year, month) - monthIndex(current.year, current.month),
  );
  if (distance > BILLING_LIMITS.competenceMonthsWindow) {
    throw new CodedError(message, 400, 'invoice_invalid');
  }
  return { year, month };
}
