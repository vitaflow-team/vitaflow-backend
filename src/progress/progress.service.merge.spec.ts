import type { AssessmentWithEducator } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
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

function assessment(
  id: string,
  day: string,
  extra: Partial<AssessmentWithEducator> = {},
  educatorName = 'Thiago Ramos',
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
    waistCm: null,
    abdomenCm: null,
    hipCm: null,
    thighCm: null,
    calfCm: null,
    createdAt: new Date(`${day}T20:00:00.000Z`),
    updatedAt: new Date(`${day}T20:00:00.000Z`),
    client: { professional: { id: 'edu-1', name: educatorName } },
    ...extra,
  };
}

describe('ProgressService — educator points', () => {
  const records = {
    findRecentByUser: jest.fn(),
    findByUserSince: jest.fn(),
    findLatestByUser: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const assessments = { findRecentByLinkedUser: jest.fn() };
  let service: ProgressService;

  function givenAssessments(list: AssessmentWithEducator[]) {
    assessments.findRecentByLinkedUser.mockResolvedValue(list);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
    records.findRecentByUser.mockResolvedValue([]);
    records.findByUserSince.mockResolvedValue([]);
    records.findLatestByUser.mockResolvedValue(null);
    givenAssessments([]);
    service = new ProgressService(
      records as unknown as MeasurementRecordsRepository,
      assessments as unknown as PhysicalAssessmentsRepository,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('UT-082 returns today own-only shape with the added fields at their SELF defaults', async () => {
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

  it('names the educator on the chart points they measured and on no other', async () => {
    const mine = own('mine', '2026-09-10T09:00:00.000Z', 80);
    records.findRecentByUser.mockResolvedValue([mine]);
    records.findByUserSince.mockResolvedValue([mine]);
    givenAssessments([assessment('theirs', '2026-09-15')]);

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

  it('UT-083 shows educator points alone in series, history, latest and variation', async () => {
    givenAssessments([
      assessment('new', '2026-09-15', { weightKg: 78.2 }),
      assessment('old', '2026-09-01', { weightKg: 79.0 }),
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

  it('UT-084 merges own and educator points into one ordered history and series', async () => {
    const mine = own('mine', '2026-09-10T09:00:00.000Z', 80);
    records.findRecentByUser.mockResolvedValue([mine]);
    records.findByUserSince.mockResolvedValue([mine]);
    givenAssessments([assessment('theirs', '2026-09-15')]);

    const dashboard = await service.getDashboard('user-1');

    expect(dashboard.history.map((p) => p.id)).toEqual(['theirs', 'mine']);
    expect(dashboard.weightSeries).toHaveLength(2);
    expect(dashboard.weightSeries[0].weightKg).toBe(80);
  });

  it('UT-085 computes an educator point BMI from the height recorded with it', async () => {
    records.findRecentByUser.mockResolvedValue([
      own('mine', '2026-09-01T09:00:00.000Z', 70),
    ]);
    givenAssessments([
      assessment('theirs', '2026-09-15', { weightKg: 80, heightCm: 200 }),
    ]);

    const dashboard = await service.getDashboard('user-1');

    expect(dashboard.history[0]).toMatchObject({ id: 'theirs', bmi: 20 });
    expect(dashboard.bmiSeries.find((p) => p.bmi === 20)).toBeDefined();
  });

  it('UT-086 carries waist and hip when the assessment has them, null otherwise', async () => {
    givenAssessments([
      assessment('full', '2026-09-15', { waistCm: 82, hipCm: 97 }),
      assessment('bare', '2026-09-01'),
    ]);

    const dashboard = await service.getDashboard('user-1');

    expect(dashboard.history[0]).toMatchObject({ waistCm: 82, hipCm: 97 });
    expect(dashboard.history[1]).toMatchObject({ waistCm: null, hipCm: null });
  });

  it('UT-087 getLatest returns the educator point when it is the newest', async () => {
    records.findLatestByUser.mockResolvedValue(
      own('mine', '2026-09-01T09:00:00.000Z'),
    );
    givenAssessments([assessment('theirs', '2026-09-15')]);

    const { latest } = await service.getLatest('user-1');

    expect(latest).toMatchObject({
      id: 'theirs',
      source: 'EDUCATOR',
      readOnly: true,
    });
    expect(assessments.findRecentByLinkedUser).toHaveBeenCalledWith(
      'user-1',
      1,
    );
  });

  it('UT-087 getLatest still returns the own record when it is the newest', async () => {
    records.findLatestByUser.mockResolvedValue(
      own('mine', '2026-09-18T09:00:00.000Z'),
    );
    givenAssessments([assessment('theirs', '2026-09-15')]);

    const { latest } = await service.getLatest('user-1');

    expect(latest).toMatchObject({ id: 'mine', source: 'SELF' });
  });

  it('UT-088 cannot change an assessment through the progress routes', async () => {
    records.findById.mockResolvedValue(null);

    await expect(
      service.update('assessment-id', 'user-1', {
        weightKg: 70,
        heightCm: 170,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.delete('assessment-id', 'user-1'),
    ).rejects.toMatchObject({ status: 404 });
    expect(records.update).not.toHaveBeenCalled();
    expect(records.delete).not.toHaveBeenCalled();
  });

  it('UT-089 labels the points of two educators with their own names', async () => {
    givenAssessments([
      assessment('a', '2026-09-15', {}, 'Thiago Ramos'),
      assessment('b', '2026-09-10', {}, 'Marina Costa'),
    ]);

    const dashboard = await service.getDashboard('user-1');

    expect(dashboard.history.map((p) => p.educatorName)).toEqual([
      'Thiago Ramos',
      'Marina Costa',
    ]);
  });

  it('UT-090 keeps an old point out of the series but in the capped history', async () => {
    givenAssessments([
      assessment('recent', '2026-09-15'),
      assessment('old', '2026-08-01'),
    ]);

    const dashboard = await service.getDashboard('user-1', 4);

    expect(dashboard.weightSeries).toHaveLength(1);
    expect(dashboard.history.map((p) => p.id)).toEqual(['recent', 'old']);
  });

  it('asks the repository for the assessments of the linked user with a day of margin', async () => {
    await service.getDashboard('user-1', 4);

    const periodCall = assessments.findRecentByLinkedUser.mock.calls.find(
      (call) => call[2] !== undefined,
    ) as [string, number, Date];
    expect(periodCall[0]).toBe('user-1');
    expect(periodCall[2].toISOString()).toBe('2026-08-21T12:00:00.000Z');
  });
});
