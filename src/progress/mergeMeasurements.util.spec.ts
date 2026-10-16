import type { FormRecordWithRecorder } from '@/repositories/clinical-records/formRecords.repository';
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

function professionalRecord(
  id: string,
  day: string,
  extra: {
    weightKg?: number;
    heightCm?: number | null;
    professionalName?: string | null;
  } = {},
): FormRecordWithRecorder {
  const recordedAt = new Date(`${day}T15:00:00.000Z`);
  return {
    id,
    clientId: 'client-1',
    templateId: 'template-1',
    recordedByUserId: 'edu-1',
    recordedAt,
    createdAt: new Date(`${day}T20:00:00.000Z`),
    updatedAt: new Date(`${day}T20:00:00.000Z`),
    client: {
      professional:
        extra.professionalName === null
          ? null
          : { id: 'edu-1', name: extra.professionalName ?? 'Thiago Ramos' },
    },
    values: [
      {
        id: `${id}-weight`,
        recordId: id,
        position: 0,
        fieldLabel: 'Peso (kg)',
        fieldType: 'NUMBER',
        weightRole: true,
        heightRole: false,
        textValue: null,
        numberValue: extra.weightKg ?? 78.2,
        boolValue: null,
        selectedOption: null,
      },
      {
        id: `${id}-height`,
        recordId: id,
        position: 1,
        fieldLabel: 'Altura (cm)',
        fieldType: 'NUMBER',
        weightRole: false,
        heightRole: true,
        textValue: null,
        numberValue: extra.heightCm === undefined ? 179 : extra.heightCm,
        boolValue: null,
        selectedOption: null,
      },
    ] as any,
  };
}

describe('mergeMeasurementPoints', () => {
  it('with no professional records keeps the own order and the SELF defaults', () => {
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

  it('with only professional records returns read-only points', () => {
    const merged = mergeMeasurementPoints(
      [],
      [
        professionalRecord('x', '2026-09-10'),
        professionalRecord('y', '2026-09-15'),
      ],
    );

    expect(merged.map((p) => p.id)).toEqual(['y', 'x']);
    expect(merged.every((p) => p.source === 'EDUCATOR' && p.readOnly)).toBe(
      true,
    );
    expect(merged[0]).toMatchObject({
      educatorName: 'Thiago Ramos',
      heightCm: 179,
      recordedAt: new Date('2026-09-15T15:00:00.000Z'),
    });
  });

  it('breaks a same-day tie by creation time, newest first', () => {
    const merged = mergeMeasurementPoints(
      [own('mine', '2026-09-15T15:00:00.000Z', 70, '2026-09-15T21:00:00.000Z')],
      [professionalRecord('theirs', '2026-09-15')],
    );

    expect(merged.map((p) => p.id)).toEqual(['mine', 'theirs']);
  });

  it('puts a professional record first when it is the newest point', () => {
    const merged = mergeMeasurementPoints(
      [own('a', '2026-09-10T09:00:00Z')],
      [professionalRecord('x', '2026-09-15')],
    );

    expect(merged[0].id).toBe('x');
  });

  it('returns every point ordered (the caller caps the list)', () => {
    const merged = mergeMeasurementPoints(
      Array.from({ length: 8 }, (_, i) =>
        own(`o${i}`, `2026-09-${String(i + 1).padStart(2, '0')}T09:00:00Z`),
      ),
      Array.from({ length: 8 }, (_, i) =>
        professionalRecord(
          `a${i}`,
          `2026-08-${String(i + 1).padStart(2, '0')}`,
        ),
      ),
    );

    expect(merged).toHaveLength(16);
    expect(merged.slice(0, 10).map((p) => p.source)).toEqual([
      ...Array(8).fill('SELF'),
      'EDUCATOR',
      'EDUCATOR',
    ]);
  });

  it('gives the instants the window comparison needs', () => {
    const since = new Date('2026-09-01T00:00:00.000Z');
    const merged = mergeMeasurementPoints(
      [],
      [
        professionalRecord('old', '2026-08-31'),
        professionalRecord('edge', '2026-09-01'),
      ],
    );

    expect(
      merged.filter((p) => p.recordedAt >= since).map((p) => p.id),
    ).toEqual(['edge']);
  });

  it('carries a null heightCm when the record has no height-tagged value', () => {
    const merged = mergeMeasurementPoints(
      [],
      [professionalRecord('weight-only', '2026-09-15', { heightCm: null })],
    );

    expect(merged[0]).toMatchObject({ weightKg: 78.2, heightCm: null });
  });

  it('attributes the point to null when the record has no linked professional', () => {
    const merged = mergeMeasurementPoints(
      [],
      [professionalRecord('orphan', '2026-09-15', { professionalName: null })],
    );

    expect(merged[0].educatorName).toBeNull();
  });
});
