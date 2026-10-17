export type BmiClassification =
  | 'ABAIXO_DO_PESO'
  | 'PESO_NORMAL'
  | 'SOBREPESO'
  | 'OBESIDADE_GRAU_I'
  | 'OBESIDADE_GRAU_II'
  | 'OBESIDADE_GRAU_III';

// Height is nullable because a generic FormRecord (clinical-records) is not
// guaranteed to carry a height-tagged value alongside its weight-tagged one
// (ADR-002) — null means "not computable", never an error.
export function calculateBmi(
  weightKg: number,
  heightCm: number | null,
): number | null {
  if (heightCm === null) return null;
  const bmi = weightKg / (heightCm / 100) ** 2;
  return Math.round(bmi * 10) / 10;
}

export function classifyBmi(bmi: number | null): BmiClassification | null {
  if (bmi === null) return null;
  if (bmi < 18.5) return 'ABAIXO_DO_PESO';
  if (bmi < 25) return 'PESO_NORMAL';
  if (bmi < 30) return 'SOBREPESO';
  if (bmi < 35) return 'OBESIDADE_GRAU_I';
  if (bmi < 40) return 'OBESIDADE_GRAU_II';
  return 'OBESIDADE_GRAU_III';
}
