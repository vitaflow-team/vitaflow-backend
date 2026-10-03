import { assessedOnToInstant } from '@/educator-students/assessments/assessedOnTimestamp.util';
import type { AssessmentWithEducator } from '@/repositories/physical-assessments/physicalAssessments.repository';
import type { MeasurementRecord } from '@prisma/client';

export type MeasurementSource = 'SELF' | 'EDUCATOR';

// One point of the student's evolution, whatever its origin. Educator points
// are read-only and always carry the educator who measured them.
export interface MergedPoint {
  id: string;
  weightKg: number;
  heightCm: number;
  waistCm: number | null;
  hipCm: number | null;
  recordedAt: Date;
  createdAt: Date;
  source: MeasurementSource;
  readOnly: boolean;
  educatorName: string | null;
}

export function ownRecordToPoint(record: MeasurementRecord): MergedPoint {
  return {
    id: record.id,
    weightKg: record.weightKg,
    heightCm: record.heightCm,
    waistCm: record.waistCm,
    hipCm: record.hipCm,
    recordedAt: record.recordedAt,
    createdAt: record.createdAt,
    source: 'SELF',
    readOnly: false,
    educatorName: null,
  };
}

export function assessmentToPoint(
  assessment: AssessmentWithEducator,
): MergedPoint {
  return {
    id: assessment.id,
    weightKg: assessment.weightKg,
    heightCm: assessment.heightCm,
    waistCm: assessment.waistCm,
    hipCm: assessment.hipCm,
    recordedAt: assessedOnToInstant(assessment.assessedOn),
    createdAt: assessment.createdAt,
    source: 'EDUCATOR',
    readOnly: true,
    educatorName: assessment.client.professional.name,
  };
}

function newestFirst(a: MergedPoint, b: MergedPoint): number {
  return (
    b.recordedAt.getTime() - a.recordedAt.getTime() ||
    b.createdAt.getTime() - a.createdAt.getTime()
  );
}

// The student's own records and the points of every linked educator in one
// list, newest first by date and then by order of entry. The single ordering
// used by the dashboard, the latest record and the prefill.
export function mergeMeasurementPoints(
  own: MeasurementRecord[],
  assessments: AssessmentWithEducator[],
): MergedPoint[] {
  return [
    ...own.map(ownRecordToPoint),
    ...assessments.map(assessmentToPoint),
  ].sort(newestFirst);
}
