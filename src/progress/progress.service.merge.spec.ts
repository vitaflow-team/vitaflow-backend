import type { FormRecordWithRecorder } from '@/repositories/clinical-records/formRecords.repository';
import { FormRecordsRepository } from '@/repositories/clinical-records/formRecords.repository';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { MeasurementRecord } from '@prisma/client';
import { ProgressService } from './progress.service';

const FIXED_NOW = new Date('2026-09-19T12:00:00.000Z');

function own(id: string, recordedAt: string, weightKg = 70): MeasurementRecord {
  const at = new Date(recordedAt);
  return {
    id,
    userId: 'user-1',
    weightKg,
    heightCm: 168,
    waistCm: null,
    hipCm: null,
    recordedAt: at,
    createdAt: at,
    updatedAt: at,
  };
}

function professionalRecord(
  id: string,
  day: string,
  extra: { weightKg?: number; heightCm?: number | null } = {},
  professionalName = 'Thiago Ramos',
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
    client: { professional: { id: 'edu-1', name: professionalName } },
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

describe('ProgressService — professional points (clinical-records)', () => {
  const records = {
    findRecentByUser: jest.fn(),
    findByUserSince: jest.fn(),
    findLatestByUser: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const formRecords = { findWeightPointsByLinkedUser: jest.fn() };
  let service: ProgressService;

  function givenProfessionalRecords(list: FormRecordWithRecorder[]) {
    formRecords.findWeightPointsByLinkedUser.mockResolvedValue(list);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
    records.findRecentByUser.mockResolvedValue([]);
    records.findByUserSince.mockResolvedValue([]);
    records.findLatestByUser.mockResolvedValue(null);
    givenProfessionalRecords([]);
    service = new ProgressService(
      records as unknown as MeasurementRecordsRepository,
      formRecords as unknown as FormRecordsRepository,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('returns today own-only shape with the added fields at their SELF defaults', async () => {
    const older = own('older', '2026-09-05T09:00:00.000Z', 72);
    const newer = own('newer', '2026-09-15T09:00:00.000Z', 70);
    records.findRecentByUser.mockResolvedValue([newer, older]);
    records.findByUserSince.mockResolvedValue([older, newer]);

    const dashboard = await service.getDashboard('user-1');

    expect(dashboard.history).toHaveLength(2);
    for (const point of dashboard.history) {
      expect(point).toMatchObject({
        source: 'SELF',
        readOnly: false,
        educatorName: null,
      });
    }
    expect(dashboard.latest?.id).toBe('newer');
    expect(dashboard.weightVariationKg).toBe(-2);
    expect(dashboard.weightSeries.map((p) => p.weightKg)).toEqual([72, 70]);
  });

  it('names the professional on the chart points they recorded and on no other', async () => {
    const mine = own('mine', '2026-09-10T09:00:00.000Z', 80);
    records.findRecentByUser.mockResolvedValue([mine]);
    records.findByUserSince.mockResolvedValue([mine]);
    givenProfessionalRecords([professionalRecord('theirs', '2026-09-15')]);

    const dashboard = await service.getDashboard('user-1');

    const [first, second] = dashboard.weightSeries;
    expect(first).toEqual({
      recordedAt: mine.recordedAt.toISOString(),
      weightKg: 80,
    });
    expect(second).toMatchObject({ educatorName: 'Thiago Ramos' });
    expect(dashboard.bmiSeries[1]).toMatchObject({
      educatorName: 'Thiago Ramos',
    });
    expect(dashboard.bmiSeries[0]).not.toHaveProperty('educatorName');
  });

  it('shows professional points alone in series, history, latest and variation', async () => {
    givenProfessionalRecords([
      professionalRecord('new', '2026-09-15', { weightKg: 78.2 }),
      professionalRecord('old', '2026-09-01', { weightKg: 79.0 }),
    ]);

    const dashboard = await service.getDashboard('user-1');

    expect(dashboard.history.map((p) => p.id)).toEqual(['new', 'old']);
    expect(dashboard.history[0]).toMatchObject({
      source: 'EDUCATOR',
      readOnly: true,
      educatorName: 'Thiago Ramos',
    });
    expect(dashboard.latest?.id).toBe('new');
    expect(dashboard.weightVariationKg).toBe(-0.8);
    expect(dashboard.weightSeries.map((p) => p.weightKg)).toEqual([79, 78.2]);
  });

  it('merges own and professional points into one ordered history and series', async () => {
    const mine = own('mine', '2026-09-10T09:00:00.000Z', 80);
    records.findRecentByUser.mockResolvedValue([mine]);
    records.findByUserSince.mockResolvedValue([mine]);
    givenProfessionalRecords([professionalRecord('theirs', '2026-09-15')]);

    const dashboard = await service.getDashboard('user-1');

    expect(dashboard.history.map((p) => p.id)).toEqual(['theirs', 'mine']);
    expect(dashboard.weightSeries).toHaveLength(2);
    expect(dashboard.weightSeries[0].weightKg).toBe(80);
  });

  it('computes a professional point BMI from the height recorded with it', async () => {
    records.findRecentByUser.mockResolvedValue([
      own('mine', '2026-09-01T09:00:00.000Z', 70),
    ]);
    givenProfessionalRecords([
      professionalRecord('theirs', '2026-09-15', {
        weightKg: 80,
        heightCm: 200,
      }),
    ]);

    const dashboard = await service.getDashboard('user-1');

    expect(dashboard.history[0]).toMatchObject({ id: 'theirs', bmi: 20 });
    expect(dashboard.bmiSeries.find((p) => p.bmi === 20)).toBeDefined();
  });

  it('omits a professional point with no height-tagged value from the bmi series', async () => {
    givenProfessionalRecords([
      professionalRecord('weight-only', '2026-09-15', { heightCm: null }),
    ]);

    const dashboard = await service.getDashboard('user-1');

    expect(dashboard.history[0]).toMatchObject({ bmi: null });
    expect(dashboard.bmiSeries).toHaveLength(0);
  });

  it('getLatest returns the professional point when it is the newest', async () => {
    records.findLatestByUser.mockResolvedValue(
      own('mine', '2026-09-01T09:00:00.000Z'),
    );
    givenProfessionalRecords([professionalRecord('theirs', '2026-09-15')]);

    const { latest } = await service.getLatest('user-1');

    expect(latest).toMatchObject({
      id: 'theirs',
      source: 'EDUCATOR',
      readOnly: true,
    });
    expect(formRecords.findWeightPointsByLinkedUser).toHaveBeenCalledWith(
      'user-1',
      1,
    );
  });

  it('getLatest still returns the own record when it is the newest', async () => {
    records.findLatestByUser.mockResolvedValue(
      own('mine', '2026-09-18T09:00:00.000Z'),
    );
    givenProfessionalRecords([professionalRecord('theirs', '2026-09-15')]);

    const { latest } = await service.getLatest('user-1');

    expect(latest).toMatchObject({ id: 'mine', source: 'SELF' });
  });

  it('cannot change a professional record through the progress routes', async () => {
    records.findById.mockResolvedValue(null);

    await expect(
      service.update('form-record-id', 'user-1', {
        weightKg: 70,
        heightCm: 170,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.delete('form-record-id', 'user-1'),
    ).rejects.toMatchObject({ status: 404 });
    expect(records.update).not.toHaveBeenCalled();
    expect(records.delete).not.toHaveBeenCalled();
  });

  it('labels the points of two professionals with their own names', async () => {
    givenProfessionalRecords([
      professionalRecord('a', '2026-09-15', {}, 'Thiago Ramos'),
      professionalRecord('b', '2026-09-10', {}, 'Marina Costa'),
    ]);

    const dashboard = await service.getDashboard('user-1');

    expect(dashboard.history.map((p) => p.educatorName)).toEqual([
      'Thiago Ramos',
      'Marina Costa',
    ]);
  });

  it('keeps an old point out of the series but in the capped history', async () => {
    givenProfessionalRecords([
      professionalRecord('recent', '2026-09-15'),
      professionalRecord('old', '2026-08-01'),
    ]);

    const dashboard = await service.getDashboard('user-1', 4);

    expect(dashboard.weightSeries).toHaveLength(1);
    expect(dashboard.history.map((p) => p.id)).toEqual(['recent', 'old']);
  });

  it('asks the repository for the professional records since the period start, no margin needed', async () => {
    await service.getDashboard('user-1', 4);

    const periodCall = formRecords.findWeightPointsByLinkedUser.mock.calls.find(
      (call) => call[2] !== undefined,
    ) as [string, number, Date];
    expect(periodCall[0]).toBe('user-1');
    expect(periodCall[2].toISOString()).toBe('2026-08-22T12:00:00.000Z');
  });

  it('UT-073 merges own points with weight points from a linked nutritionist', async () => {
    givenProfessionalRecords([
      professionalRecord('nutri-point', '2026-09-15', {}, 'Ana Nutri'),
    ]);

    const dashboard = await service.getDashboard('user-1');

    expect(dashboard.weightSeries).toContainEqual(
      expect.objectContaining({ weightKg: 78.2, educatorName: 'Ana Nutri' }),
    );
  });

  it('UT-074 merges own points with weight points from a linked physical educator, unchanged from before', async () => {
    givenProfessionalRecords([
      professionalRecord('educator-point', '2026-09-15', {}, 'Thiago Ramos'),
    ]);

    const dashboard = await service.getDashboard('user-1');

    expect(dashboard.weightSeries).toContainEqual(
      expect.objectContaining({ weightKg: 78.2, educatorName: 'Thiago Ramos' }),
    );
  });

  it('UT-075 a user with both a linked nutritionist and a linked physical educator sees both in one merged series', async () => {
    givenProfessionalRecords([
      professionalRecord(
        'nutri-point',
        '2026-09-15',
        { weightKg: 68 },
        'Ana Nutri',
      ),
      professionalRecord(
        'educator-point',
        '2026-09-10',
        { weightKg: 70 },
        'Thiago Ramos',
      ),
    ]);

    const dashboard = await service.getDashboard('user-1');

    const names = dashboard.weightSeries.map((p) => p.educatorName).sort();
    expect(names).toEqual(['Ana Nutri', 'Thiago Ramos']);
    expect(dashboard.weightSeries.map((p) => p.weightKg).sort()).toEqual([
      68, 70,
    ]);
  });
});
