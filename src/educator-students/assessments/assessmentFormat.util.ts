import type { PhysicalAssessment } from '@prisma/client';
import type { AssessmentResponseDTO } from './dto/assessmentResponse.Dto';

// `YYYY-MM-DD` of a stored calendar date (a `@db.Date` comes back as UTC
// midnight, so the UTC slice is the date that was saved).
export function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toAssessmentResponse(
  assessment: PhysicalAssessment,
): AssessmentResponseDTO {
  return {
    id: assessment.id,
    studentId: assessment.clientId,
    assessedOn: toIsoDay(assessment.assessedOn),
    weightKg: assessment.weightKg,
    heightCm: assessment.heightCm,
    bodyFatPercent: assessment.bodyFatPercent,
    restingHeartRate: assessment.restingHeartRate,
    flexibilityCm: assessment.flexibilityCm,
    armCm: assessment.armCm,
    chestCm: assessment.chestCm,
    waistCm: assessment.waistCm,
    abdomenCm: assessment.abdomenCm,
    hipCm: assessment.hipCm,
    thighCm: assessment.thighCm,
    calfCm: assessment.calfCm,
    createdAt: assessment.createdAt.toISOString(),
  };
}
