export interface WeightVariationInput {
  recordedAt: Date;
  weightKg: number | null;
}

export interface StudentWeightVariation {
  weightKg: number;
}

// Change in the weight-tagged value from the first to the latest assessment
// with one on record — the generic engine no longer has a fixed "body fat"
// field to track alongside it (ADR-002 only reserves weightRole/heightRole),
// so this generalizes assessmentVariation.util.ts's weightKg half only.
// Fewer than two weight-bearing records have no change (null, never zero).
export function computeWeightVariation(
  records: WeightVariationInput[],
): StudentWeightVariation | null {
  const withWeight = records.filter((r) => r.weightKg !== null);
  if (withWeight.length < 2) return null;

  const ordered = [...withWeight].sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
  );
  const first = ordered[0];
  const latest = ordered[ordered.length - 1];

  return {
    weightKg: Math.round((latest.weightKg! - first.weightKg!) * 10) / 10 + 0,
  };
}
