export type BmiClassification =
  | 'ABAIXO_DO_PESO'
  | 'PESO_NORMAL'
  | 'SOBREPESO'
  | 'OBESIDADE_GRAU_I'
  | 'OBESIDADE_GRAU_II'
  | 'OBESIDADE_GRAU_III';

export function calculateBmi(weightKg: number, heightCm: number): number {
  const bmi = weightKg / (heightCm / 100) ** 2;
  return Math.round(bmi * 10) / 10;
}

export function classifyBmi(bmi: number): BmiClassification {
  if (bmi < 18.5) return 'ABAIXO_DO_PESO';
  if (bmi < 25) return 'PESO_NORMAL';
  if (bmi < 30) return 'SOBREPESO';
  if (bmi < 35) return 'OBESIDADE_GRAU_I';
  if (bmi < 40) return 'OBESIDADE_GRAU_II';
  return 'OBESIDADE_GRAU_III';
}
