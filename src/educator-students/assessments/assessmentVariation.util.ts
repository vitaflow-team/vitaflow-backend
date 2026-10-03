import type { AssessmentVariationDTO } from './dto/assessmentResponse.Dto';

export interface VariationInput {
  assessedOn: Date;
  createdAt: Date;
  weightKg: number;
  bodyFatPercent: number | null;
}

function oneDecimal(value: number): number {
  // `+ 0` turns a rounded -0 into 0.
  return Math.round(value * 10) / 10 + 0;
}

function byDateThenEntry(a: VariationInput, b: VariationInput): number {
  return (
    a.assessedOn.getTime() - b.assessedOn.getTime() ||
    a.createdAt.getTime() - b.createdAt.getTime()
  );
}

// Change from the first to the latest assessment, by assessment date and then
// by order of entry — never by when a value happened to be typed in. Fewer than
// two assessments have no change (null, never zero); the body-fat change is
// taken only between assessments that both recorded it.
export function computeVariation(
  assessments: VariationInput[],
): AssessmentVariationDTO | null {
  if (assessments.length < 2) return null;

  const ordered = [...assessments].sort(byDateThenEntry);
  const first = ordered[0];
  const latest = ordered[ordered.length - 1];

  const withBodyFat = ordered.filter((a) => a.bodyFatPercent !== null);
  const bodyFatPoints =
    withBodyFat.length < 2
      ? null
      : oneDecimal(
          withBodyFat[withBodyFat.length - 1].bodyFatPercent! -
            withBodyFat[0].bodyFatPercent!,
        );

  return {
    weightKg: oneDecimal(latest.weightKg - first.weightKg),
    bodyFatPoints,
  };
}
