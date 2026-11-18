import { daysBetween } from '@/billing/shared/dates';
import {
  competenceOf,
  dueDateOf,
  firstDueDate,
  nextCompetence,
} from './recurringBillingRules';
import { RECURRING_BILLING_LIMITS } from './recurringBillingLimits';
import type { Competence } from '@/billing/shared/types/competence';
import type { FeePlan } from './types/feePlan';
import type { PlannedFee } from './types/plannedFee';

interface NextCompetenceInput {
  // The highest competence among all the row's invoices (any status).
  last: Competence | null;
  dueDay: number;
  startedAtKey: string;
}

// The competence the row issues next: the month after its highest invoice, or
// the first competence when it has none yet (a leftover row without its first
// fee is repaired by the next run).
export function nextCompetenceToIssue(input: NextCompetenceInput): Competence {
  if (input.last) return nextCompetence(input.last);
  return competenceOf(firstDueDate(input.dueDay, input.startedAtKey));
}

interface FeePlanInput {
  next: Competence;
  dueDay: number;
  today: string;
}

// Walks the months from `next` while their due date is within the lead time.
// A month whose due date already passed is a missed one: issued with due date
// today and its original competence, at most the most recent few.
export function planFees(input: FeePlanInput): FeePlan {
  const missed: Competence[] = [];
  const upcoming: PlannedFee[] = [];
  let competence = input.next;
  for (;;) {
    const dueDate = dueDateOf(competence, input.dueDay);
    const days = daysBetween(input.today, dueDate);
    if (days > RECURRING_BILLING_LIMITS.issueLeadDays) break;
    if (days < 0) missed.push(competence);
    else upcoming.push({ competence, dueDate });
    competence = nextCompetence(competence);
  }
  const cap = RECURRING_BILLING_LIMITS.catchUpMaxMonths;
  const kept = missed.slice(-cap);
  const caughtUp = kept.map((c) => ({ competence: c, dueDate: input.today }));
  return {
    fees: [...caughtUp, ...upcoming],
    cappedMonths: missed.length - kept.length,
  };
}
