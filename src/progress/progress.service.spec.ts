import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { AppError } from '@/utils/app.erro';
import { MeasurementRecord } from '@prisma/client';
import { ProgressService } from './progress.service';

const FIXED_NOW = new Date('2026-09-19T12:00:00.000Z');

function record(
  id: string,
  weightKg: number,
  recordedAt: string,
  userId = 'user-1',
  heightCm = 168,
): MeasurementRecord {
  const timestamp = new Date(recordedAt);
  return {
    id,
    userId,
    weightKg,
    heightCm,
    waistCm: null,
    hipCm: null,
    recordedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('ProgressService', () => {
  const repository = {
    create: jest.fn(),
    findById: jest.fn(),
    findLatestByUser: jest.fn(),
    findRecentByUser: jest.fn(),
    findByUserSince: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  let service: ProgressService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
    service = new ProgressService(
      repository as unknown as MeasurementRecordsRepository,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('UT-007 defaults to an exact 8-week window and reports it', async () => {
    repository.findRecentByUser.mockResolvedValue([]);
    repository.findByUserSince.mockResolvedValue([]);

    const dashboard = await service.getDashboard('user-1');

    expect(repository.findByUserSince).toHaveBeenCalledWith(
      'user-1',
      new Date('2026-07-25T12:00:00.000Z'),
    );
    expect(dashboard.period).toEqual({
      weeks: 8,
      start: '2026-07-25T12:00:00.000Z',
      end: '2026-09-19T12:00:00.000Z',
    });
  });

  it('UT-008 uses and reports an exact 4-week window', async () => {
    repository.findRecentByUser.mockResolvedValue([]);
    repository.findByUserSince.mockResolvedValue([]);

    const dashboard = await service.getDashboard('user-1', 4);

    expect(repository.findByUserSince).toHaveBeenCalledWith(
      'user-1',
      new Date('2026-08-22T12:00:00.000Z'),
    );
    expect(dashboard.period.weeks).toBe(4);
  });

  it('UT-009 uses and reports an exact 12-week window', async () => {
    repository.findRecentByUser.mockResolvedValue([]);
    repository.findByUserSince.mockResolvedValue([]);

    const dashboard = await service.getDashboard('user-1', 12);

    expect(repository.findByUserSince).toHaveBeenCalledWith(
      'user-1',
      new Date('2026-06-27T12:00:00.000Z'),
    );
    expect(dashboard.period.weeks).toBe(12);
  });

  it.each([
    [4, '2026-08-22T12:00:00.000Z'],
    [8, '2026-07-25T12:00:00.000Z'],
    [12, '2026-06-27T12:00:00.000Z'],
  ] as const)(
    'UT-010 reports the exact repository window for %i weeks',
    async (weeks, expectedStart) => {
      repository.findRecentByUser.mockResolvedValue([]);
      repository.findByUserSince.mockResolvedValue([]);

      const dashboard = await service.getDashboard('user-1', weeks);
      const since = repository.findByUserSince.mock.calls.at(-1)?.[1] as Date;

      expect(dashboard.period).toEqual({
        weeks,
        start: since.toISOString(),
        end: FIXED_NOW.toISOString(),
      });
      expect(dashboard.period.start).toBe(expectedStart);
    },
  );

  it('UT-011 keeps latest, variation, and history independent of weeks', async () => {
    const previous = record('1', 63, '2026-09-12T12:00:00.000Z');
    const latest = record('2', 62, '2026-09-18T12:00:00.000Z');
    repository.findRecentByUser.mockResolvedValue([latest, previous]);
    repository.findByUserSince.mockResolvedValue([previous, latest]);

    const dashboards = await Promise.all(
      ([4, 8, 12] as const).map((weeks) =>
        service.getDashboard('user-1', weeks),
      ),
    );

    const independentFields = dashboards.map(
      ({ latest: current, weightVariationKg, history }) => ({
        latest: current,
        weightVariationKg,
        history,
      }),
    );
    expect(independentFields[1]).toEqual(independentFields[0]);
    expect(independentFields[2]).toEqual(independentFields[0]);
  });

  it('UT-012 includes a record exactly at the period start once', async () => {
    const boundary = record('boundary', 62, '2026-08-22T12:00:00.000Z');
    const older = record('older', 63, '2026-08-22T11:59:59.999Z');
    repository.findRecentByUser.mockResolvedValue([boundary, older]);
    repository.findByUserSince.mockImplementation(
      (_userId: string, since: Date) =>
        Promise.resolve(
          [older, boundary].filter((item) => item.recordedAt >= since),
        ),
    );

    const dashboard = await service.getDashboard('user-1', 4);

    expect(dashboard.weightSeries).toEqual([
      { recordedAt: boundary.recordedAt.toISOString(), weightKg: 62 },
    ]);
  });

  it('UT-013 keeps an older record in latest/history but out of series', async () => {
    const old = record('old', 62, '2026-08-08T12:00:00.000Z');
    repository.findRecentByUser.mockResolvedValue([old]);
    repository.findByUserSince.mockImplementation(
      (_userId: string, since: Date) =>
        Promise.resolve([old].filter((item) => item.recordedAt >= since)),
    );

    const dashboard = await service.getDashboard('user-1', 4);

    expect(dashboard.latest?.id).toBe('old');
    expect(dashboard.history.map(({ id }) => id)).toEqual(['old']);
    expect(dashboard.weightSeries).toEqual([]);
    expect(dashboard.bmiSeries).toEqual([]);
  });

  it('UT-023 aggregates latest, variation, history, and both series', async () => {
    const oldest = record('1', 63.4, '2026-09-01T09:00:00.000Z');
    const middle = record('2', 62.6, '2026-09-08T09:00:00.000Z');
    const latest = record('3', 62, '2026-09-15T09:00:00.000Z');
    repository.findRecentByUser.mockResolvedValue([latest, middle, oldest]);
    repository.findByUserSince.mockResolvedValue([oldest, middle, latest]);

    const dashboard = await service.getDashboard('user-1');

    expect(repository.findRecentByUser).toHaveBeenCalledWith('user-1', 10);
    expect(repository.findByUserSince).toHaveBeenCalledWith(
      'user-1',
      expect.any(Date),
    );
    expect(dashboard.latest?.weightKg).toBe(62);
    expect(dashboard.weightVariationKg).toBe(-0.6);
    expect(dashboard.history.map(({ id }) => id)).toEqual(['3', '2', '1']);
    expect(dashboard.weightSeries.map(({ weightKg }) => weightKg)).toEqual([
      63.4, 62.6, 62,
    ]);
    expect(dashboard.bmiSeries).toHaveLength(3);
    expect(dashboard.history.every(({ bmi }) => Number.isFinite(bmi))).toBe(
      true,
    );
  });

  it('UT-024 returns null variation for one record', async () => {
    const only = record('1', 62, '2026-09-15T09:00:00.000Z');
    repository.findRecentByUser.mockResolvedValue([only]);
    repository.findByUserSince.mockResolvedValue([only]);

    const dashboard = await service.getDashboard('user-1');

    expect(dashboard.weightVariationKg).toBeNull();
  });

  it('UT-025 returns the complete empty dashboard shape', async () => {
    repository.findRecentByUser.mockResolvedValue([]);
    repository.findByUserSince.mockResolvedValue([]);

    await expect(service.getDashboard('user-1')).resolves.toEqual({
      latest: null,
      weightVariationKg: null,
      weightSeries: [],
      bmiSeries: [],
      history: [],
      period: {
        weeks: 8,
        start: '2026-07-25T12:00:00.000Z',
        end: '2026-09-19T12:00:00.000Z',
      },
    });
  });

  it('UT-026 keeps old records in cards/history and out of series', async () => {
    const old = record('1', 62, '2026-07-01T09:00:00.000Z');
    repository.findRecentByUser.mockResolvedValue([old]);
    repository.findByUserSince.mockResolvedValue([]);

    const dashboard = await service.getDashboard('user-1');

    expect(dashboard.latest?.id).toBe('1');
    expect(dashboard.history).toHaveLength(1);
    expect(dashboard.weightSeries).toEqual([]);
    expect(dashboard.bmiSeries).toEqual([]);
  });

  it('UT-027 respects full-timestamp ordering for same-day records', async () => {
    const morning = record('morning', 63, '2026-09-19T09:00:00.000Z');
    const evening = record('evening', 62.5, '2026-09-19T20:00:00.000Z');
    repository.findRecentByUser.mockResolvedValue([evening, morning]);
    repository.findByUserSince.mockResolvedValue([morning, evening]);

    const dashboard = await service.getDashboard('user-1');

    expect(dashboard.latest?.weightKg).toBe(62.5);
    expect(dashboard.weightVariationKg).toBe(-0.5);
  });

  it('UT-028 rejects update by a non-owner without mutating', async () => {
    repository.findById.mockResolvedValue(
      record('record-1', 62, '2026-09-19T09:00:00.000Z', 'other-user'),
    );

    const error = await service
      .update('record-1', 'user-1', { weightKg: 61, heightCm: 168 })
      .catch((caught: AppError) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toBe('Ação não permitida.');
    expect(error.getStatus()).toBe(401);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('UT-029 rejects delete by a non-owner without mutating', async () => {
    repository.findById.mockResolvedValue(
      record('record-1', 62, '2026-09-19T09:00:00.000Z', 'other-user'),
    );

    const error = await service
      .delete('record-1', 'user-1')
      .catch((caught: AppError) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toBe('Ação não permitida.');
    expect(error.getStatus()).toBe(401);
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('UT-030 creates a record and derives BMI response fields', async () => {
    repository.create.mockResolvedValue({
      ...record('record-1', 61.4, '2026-09-19T09:00:00.000Z'),
      waistCm: 78,
    });

    const result = await service.create('user-1', {
      weightKg: 61.4,
      heightCm: 168,
      waistCm: 78,
    });

    expect(repository.create).toHaveBeenCalledWith('user-1', {
      weightKg: 61.4,
      heightCm: 168,
      waistCm: 78,
    });
    expect(result).toEqual(
      expect.objectContaining({
        bmi: 21.8,
        bmiClassification: 'PESO_NORMAL',
        hipCm: null,
      }),
    );
  });

  it('UT-031 rejects update when the record does not exist', async () => {
    repository.findById.mockResolvedValue(null);

    const error = await service
      .update('missing', 'user-1', { weightKg: 61, heightCm: 168 })
      .catch((caught: AppError) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toBe('Registro não encontrado.');
    expect(error.getStatus()).toBe(404);
    expect(repository.update).not.toHaveBeenCalled();
  });

  describe('latest record', () => {
    it('UT-003 returns the latest record wrapped with its derived fields', async () => {
      const latest = record('record-1', 82.4, '2026-09-15T15:00:00.000Z');
      repository.findLatestByUser.mockResolvedValue(latest);

      const result = await service.getLatest('u1');

      expect(repository.findLatestByUser).toHaveBeenCalledTimes(1);
      expect(repository.findLatestByUser).toHaveBeenCalledWith('u1');
      expect(result).toEqual({
        latest: {
          id: 'record-1',
          weightKg: 82.4,
          heightCm: 168,
          waistCm: null,
          hipCm: null,
          recordedAt: '2026-09-15T15:00:00.000Z',
          bmi: 29.2,
          bmiClassification: 'SOBREPESO',
        },
      });
    });

    it('UT-004 returns the wrapper with null when there is no record', async () => {
      repository.findLatestByUser.mockResolvedValue(null);

      await expect(service.getLatest('u1')).resolves.toEqual({ latest: null });
    });
  });
});
