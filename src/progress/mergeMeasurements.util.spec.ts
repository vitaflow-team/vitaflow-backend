import type { AssessmentWithEducator } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { MeasurementRecord } from '@prisma/client';
import { mergeMeasurementPoints } from './mergeMeasurements.util';

function own(
  id: string,
  recordedAt: string,
  weightKg = 70,
  createdAt = recordedAt,
): MeasurementRecord {
  return {
    id,
    userId: 'user-1',
    weightKg,
    heightCm: 168,
    waistCm: null,
    hipCm: null,
    recordedAt: new Date(recordedAt),
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
  };
}

function assessment(
  id: string,
  day: string,
  extra: Partial<AssessmentWithEducator> = {},
): AssessmentWithEducator {
  return {
    id,
    clientId: 'client-1',
    assessedOn: new Date(`${day}T00:00:00.000Z`),
    weightKg: 78.2,
    heightCm: 179,
    bodyFatPercent: null,
    restingHeartRate: null,
    flexibilityCm: null,
    armCm: null,
    chestCm: null,
    waistCm: 82,
    abdomenCm: null,
    hipCm: 97,
    thighCm: null,
    calfCm: null,
    createdAt: new Date(`${day}T20:00:00.000Z`),
    updatedAt: new Date(`${day}T20:00:00.000Z`),
    client: { professional: { id: 'edu-1', name: 'Thiago Ramos' } },
    ...extra,
  };
}

describe('mergeMeasurementPoints', () => {
  it('UT-022 with no assessments keeps the own order and the SELF defaults', () => {
    const merged = mergeMeasurementPoints(
      [own('a', '2026-09-10T09:00:00Z'), own('b', '2026-09-15T09:00:00Z')],
      [],
    );

    expect(merged.map((p) => p.id)).toEqual(['b', 'a']);
    expect(merged.every((p) => p.source === 'SELF')).toBe(true);
    expect(merged.every((p) => !p.readOnly && p.educatorName === null)).toBe(
      true,
    );
  });

  it('UT-023 with only assessments returns read-only educator points', () => {
    const merged = mergeMeasurementPoints(
      [],
      [assessment('x', '2026-09-10'), assessment('y', '2026-09-15')],
    );

    expect(merged.map((p) => p.id)).toEqual(['y', 'x']);
    expect(merged.every((p) => p.source === 'EDUCATOR' && p.readOnly)).toBe(
      true,
    );
    expect(merged[0]).toMatchObject({
      educatorName: 'Thiago Ramos',
      waistCm: 82,
      hipCm: 97,
      recordedAt: new Date('2026-09-15T15:00:00.000Z'),
    });
  });

  it('UT-024 breaks a same-day tie by creation time, newest first', () => {
    const merged = mergeMeasurementPoints(
      [own('mine', '2026-09-15T15:00:00.000Z', 70, '2026-09-15T21:00:00.000Z')],
      [assessment('theirs', '2026-09-15')],
    );

    expect(merged.map((p) => p.id)).toEqual(['mine', 'theirs']);
  });

  it('UT-025 puts an assessment first when it is the newest point', () => {
    const merged = mergeMeasurementPoints(
      [own('a', '2026-09-10T09:00:00Z')],
      [assessment('x', '2026-09-15')],
    );

    expect(merged[0].id).toBe('x');
  });

  it('UT-026 returns every point ordered (the caller caps the list)', () => {
    const merged = mergeMeasurementPoints(
      Array.from({ length: 8 }, (_, i) =>
        own(`o${i}`, `2026-09-${String(i + 1).padStart(2, '0')}T09:00:00Z`),
      ),
      Array.from({ length: 8 }, (_, i) =>
        assessment(`a${i}`, `2026-08-${String(i + 1).padStart(2, '0')}`),
      ),
    );

    expect(merged).toHaveLength(16);
    expect(merged.slice(0, 10).map((p) => p.source)).toEqual([
      ...Array(8).fill('SELF'),
      'EDUCATOR',
      'EDUCATOR',
    ]);
  });

  it('UT-027 gives the instants the window comparison needs', () => {
    const since = new Date('2026-09-01T00:00:00.000Z');
    const merged = mergeMeasurementPoints(
      [],
      [assessment('old', '2026-08-31'), assessment('edge', '2026-09-01')],
    );

    expect(
      merged.filter((p) => p.recordedAt >= since).map((p) => p.id),
    ).toEqual(['edge']);
  });
});
