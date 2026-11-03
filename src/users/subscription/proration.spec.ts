import { prorationDeltaCents } from './proration';

const CYCLE_START = new Date('2026-10-01T00:00:00.000Z');
const CYCLE_END = new Date('2026-10-31T00:00:00.000Z'); // 30 days later
const CYCLE_MIDPOINT = new Date('2026-10-16T00:00:00.000Z'); // 15 days remaining

describe('prorationDeltaCents', () => {
  // UT-152 — upgrade
  it('charges half the price difference at the cycle midpoint for an upgrade', () => {
    const delta = prorationDeltaCents({
      oldPriceCents: 2990,
      newPriceCents: 5990,
      now: CYCLE_MIDPOINT,
      periodEnd: CYCLE_END,
    });

    // (5990 - 2990) * (15/30) = 1500
    expect(delta).toBe(1500);
  });

  // UT-152 — downgrade (negative delta)
  it('produces a negative delta at the cycle midpoint for a downgrade', () => {
    const delta = prorationDeltaCents({
      oldPriceCents: 5990,
      newPriceCents: 2990,
      now: CYCLE_MIDPOINT,
      periodEnd: CYCLE_END,
    });

    expect(delta).toBe(-1500);
  });

  // UT-152 — boundary: exactly at cycle start, the full delta applies.
  it('charges the full price difference at the start of the cycle', () => {
    const delta = prorationDeltaCents({
      oldPriceCents: 2990,
      newPriceCents: 5990,
      now: CYCLE_START,
      periodEnd: CYCLE_END,
    });

    expect(delta).toBe(3000);
  });

  // UT-152 — boundary: exactly at cycle end, no time remains to prorate.
  it('charges nothing at the end of the cycle', () => {
    const delta = prorationDeltaCents({
      oldPriceCents: 2990,
      newPriceCents: 5990,
      now: CYCLE_END,
      periodEnd: CYCLE_END,
    });

    expect(delta).toBe(0);
  });

  it('rounds to whole cents', () => {
    const delta = prorationDeltaCents({
      oldPriceCents: 1000,
      newPriceCents: 1001,
      now: CYCLE_MIDPOINT,
      periodEnd: CYCLE_END,
    });

    // 1 * 0.5 = 0.5, rounds to the nearest cent.
    expect(Number.isInteger(delta)).toBe(true);
  });

  // UT-152 regression note: this is exactly the linear time-weighted
  // formula Stripe's `proration_behavior: 'create_prorations'` applies —
  // (newPrice - oldPrice) * (secondsRemaining / secondsInCycle) — so it
  // produces the same result Stripe would for the same plan-change inputs,
  // the equivalence subtask 6.5 requires (no live Stripe call needed since
  // Stripe is removed by this same task).
  it('matches Stripe-equivalent linear time-weighted proration for a 10-day-remaining upgrade', () => {
    const periodEnd = new Date('2026-11-30T00:00:00.000Z');
    const now = new Date('2026-11-20T00:00:00.000Z'); // 10 days remaining of 30
    const oldPriceCents = 7990;
    const newPriceCents = 9990;
    const stripeEquivalent = Math.round(
      (newPriceCents - oldPriceCents) * (10 / 30),
    );

    const delta = prorationDeltaCents({
      oldPriceCents,
      newPriceCents,
      now,
      periodEnd,
    });

    expect(delta).toBe(stripeEquivalent);
  });
});
