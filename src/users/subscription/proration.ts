const CYCLE_DAYS = 30;
const SECONDS_IN_CYCLE = CYCLE_DAYS * 24 * 60 * 60;

export interface ProrationInput {
  oldPriceCents: number;
  newPriceCents: number;
  now: Date;
  periodEnd: Date;
}

// ADR-010 TechSpec addendum, "Proration formula": the same time-weighted
// delta Stripe's `proration_behavior: 'create_prorations'` computes —
// `(newPrice - oldPrice) * secondsRemainingInCycle / secondsInCycle` —
// issued here as a one-off Asaas charge instead of a gateway-side
// calculation (UT-152).
export function prorationDeltaCents(input: ProrationInput): number {
  const secondsRemaining = Math.max(
    0,
    (input.periodEnd.getTime() - input.now.getTime()) / 1000,
  );
  const fraction = Math.min(1, secondsRemaining / SECONDS_IN_CYCLE);
  return Math.round((input.newPriceCents - input.oldPriceCents) * fraction);
}
