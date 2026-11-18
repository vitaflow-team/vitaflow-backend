import type { Competence } from '@/billing/shared/types/competence';

// What one issuer run reads once and shares across every row.
export interface RunContext {
  today: string;
  lastCompetences: Map<string, Competence>;
  planPrices: Map<string, number>;
}
