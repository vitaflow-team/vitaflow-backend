import { BILLING_LIMITS } from '@/billing/shared/billingLimits';
import { CodedError } from '@/common/errors/codedError';
import { RECURRING_BILLING_LIMITS } from './recurringBillingLimits';
import type { Competence } from '@/billing/shared/types/competence';

const INVALID_DUE_DAY = `O dia de vencimento deve ser um número de ${RECURRING_BILLING_LIMITS.dueDayMin} a ${RECURRING_BILLING_LIMITS.dueDayMax}.`;
const INVALID_AMOUNT = 'O valor da mensalidade está fora do limite permitido.';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// The competence month of a `YYYY-MM-DD` date.
export function competenceOf(dateKey: string): Competence {
  return {
    year: Number(dateKey.slice(0, 4)),
    month: Number(dateKey.slice(5, 7)),
  };
}

export function nextCompetence(competence: Competence): Competence {
  return competence.month === 12
    ? { year: competence.year + 1, month: 1 }
    : { year: competence.year, month: competence.month + 1 };
}

// Due day 1..28 exists in every month, so this is always a real date.
export function dueDateOf(competence: Competence, dueDay: number): string {
  return `${competence.year}-${pad(competence.month)}-${pad(dueDay)}`;
}

// The owner's default due day is the day of the link, capped at the last day
// every month has.
export function defaultDueDay(todayKey: string): number {
  return Math.min(
    Number(todayKey.slice(8, 10)),
    RECURRING_BILLING_LIMITS.dueDayMax,
  );
}

// The first fee is due on the next occurrence of the chosen day; today counts
// when the day equals today (US-012 AC-3).
export function firstDueDate(dueDay: number, todayKey: string): string {
  const today = Number(todayKey.slice(8, 10));
  const month = competenceOf(todayKey);
  return dueDateOf(dueDay >= today ? month : nextCompetence(month), dueDay);
}

export function parseDueDay(raw: unknown): number {
  const valid =
    typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= RECURRING_BILLING_LIMITS.dueDayMin &&
    raw <= RECURRING_BILLING_LIMITS.dueDayMax;
  if (!valid) throw new CodedError(INVALID_DUE_DAY, 400, 'invalid_due_day');
  return raw;
}

export function parseAmountCents(raw: unknown): number {
  const valid =
    typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= BILLING_LIMITS.amountMinCents &&
    raw <= BILLING_LIMITS.amountMaxCents;
  if (!valid) throw new CodedError(INVALID_AMOUNT, 400, 'invalid_amount');
  return raw;
}

// A catalog price in reais (a Decimal column) as integer cents.
export function priceToCents(referencePrice: unknown): number {
  return Math.round(Number(referencePrice) * 100);
}

function isBillablePrice(cents: number): boolean {
  return (
    cents >= BILLING_LIMITS.amountMinCents &&
    cents <= BILLING_LIMITS.amountMaxCents
  );
}

// What the next fee costs: a custom amount is kept; otherwise the fee follows
// the catalog price as it is now, falling back to the stored amount when the
// plan is gone or its price cannot be charged (US-014 EC-1).
export function effectiveAmountCents(
  billing: { amountCents: number; customAmount: boolean },
  planPriceCents: number | null,
): number {
  if (billing.customAmount) return billing.amountCents;
  if (planPriceCents !== null && isBillablePrice(planPriceCents)) {
    return planPriceCents;
  }
  return billing.amountCents;
}

// The first fee of a row: due on the next occurrence of its day, competence
// the month of that due date (ADR-007).
export function firstFeeOf(
  dueDay: number,
  todayKey: string,
): { competence: Competence; dueDate: string } {
  const dueDate = firstDueDate(dueDay, todayKey);
  return { competence: competenceOf(dueDate), dueDate };
}
