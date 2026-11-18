import type { Competence } from '@/billing/shared/types/competence';

// One fee the issuer should create now: its original competence and the due
// date it will carry (the natural one, or today for a missed month).
export interface PlannedFee {
  competence: Competence;
  dueDate: string;
}
