import type { FormRecordWithRecorder } from '@/repositories/clinical-records/formRecords.repository';
import type { MeasurementRecord } from '@prisma/client';

export type MeasurementSource = 'SELF' | 'EDUCATOR';

// One point of the student's evolution, whatever its origin. A professional
// point ("EDUCATOR", generalized by ADR-011 to any linked professional type —
// nutritionist, physical educator, or academia) is read-only and always
// carries the name of whoever recorded it. heightCm is nullable because a
// generic FormRecord is not guaranteed to carry a height-tagged value
// alongside its weight-tagged one.
export interface MergedPoint {
  id: string;
  weightKg: number;
  heightCm: number | null;
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

// The first weight-tagged value (by position) is the point's weight; a
// height-tagged value alongside it (same record) is carried too, null when
// the professional's template didn't also tag one (ADR-002/ADR-011).
export function formRecordToPoint(record: FormRecordWithRecorder): MergedPoint {
  const weight = record.values.find(
    (value) => value.weightRole && value.numberValue !== null,
  );
  const height = record.values.find(
    (value) => value.heightRole && value.numberValue !== null,
  );

  return {
    id: record.id,
    weightKg: weight!.numberValue!,
    heightCm: height?.numberValue ?? null,
    waistCm: null,
    hipCm: null,
    recordedAt: record.recordedAt,
    createdAt: record.createdAt,
    source: 'EDUCATOR',
    readOnly: true,
    educatorName: record.client.professional?.name ?? null,
  };
}

function newestFirst(a: MergedPoint, b: MergedPoint): number {
  return (
    b.recordedAt.getTime() - a.recordedAt.getTime() ||
    b.createdAt.getTime() - a.createdAt.getTime()
  );
}

// The student's own records and the points of every linked professional in
// one list, newest first by date and then by order of entry. The single
// ordering used by the dashboard, the latest record and the prefill.
export function mergeMeasurementPoints(
  own: MeasurementRecord[],
  professionalRecords: FormRecordWithRecorder[],
): MergedPoint[] {
  return [
    ...own.map(ownRecordToPoint),
    ...professionalRecords.map(formRecordToPoint),
  ].sort(newestFirst);
}
