// Response shapes only: plain interfaces, never validated at runtime.
export interface AssessmentResponseDTO {
  id: string;
  studentId: string;
  /** Calendar date, `YYYY-MM-DD`. */
  assessedOn: string;
  weightKg: number;
  heightCm: number;
  bodyFatPercent: number | null;
  restingHeartRate: number | null;
  flexibilityCm: number | null;
  armCm: number | null;
  chestCm: number | null;
  waistCm: number | null;
  abdomenCm: number | null;
  hipCm: number | null;
  thighCm: number | null;
  calfCm: number | null;
  createdAt: string;
}

export interface AssessmentVariationDTO {
  /** Latest minus first weight, in kg. */
  weightKg: number;
  /** Latest minus first body fat among assessments that have it, in points. */
  bodyFatPoints: number | null;
}
