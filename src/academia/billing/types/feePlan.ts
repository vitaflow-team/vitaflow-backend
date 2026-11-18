import type { PlannedFee } from './plannedFee';

export interface FeePlan {
  fees: PlannedFee[];
  // Missed months older than the catch-up cap, which are never issued.
  cappedMonths: number;
}
