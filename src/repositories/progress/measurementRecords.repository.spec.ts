import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { MeasurementRecord } from '@prisma/client';
import { MeasurementRecordsRepository } from './measurementRecords.repository';

function makeRecord(index: number): MeasurementRecord {
  const timestamp = new Date(
    `2026-09-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
  );
  return {
    id: `record-${index}`,
    userId: 'user-1',
    weightKg: 60 + index,
    heightCm: 168,
    waistCm: null,
    hipCm: null,
    recordedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('MeasurementRecordsRepository', () => {
  const findMany = jest.fn();
  const findFirst = jest.fn();
  let repository: MeasurementRecordsRepository;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeasurementRecordsRepository,
        {
          provide: PrismaService,
          useValue: { measurementRecord: { findMany, findFirst } },
        },
      ],
    }).compile();
    repository = module.get(MeasurementRecordsRepository);
  });

  it('UT-032 returns the 10 most recent records descending', async () => {
    const records = Array.from({ length: 15 }, (_, index) => makeRecord(index))
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
      .slice(0, 10);
    findMany.mockResolvedValue(records);

    const result = await repository.findRecentByUser('user-1', 10);

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { recordedAt: 'desc' },
      take: 10,
    });
    expect(result).toHaveLength(10);
    expect(result.map(({ recordedAt }) => recordedAt.getTime())).toEqual(
      [...result]
        .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
        .map(({ recordedAt }) => recordedAt.getTime()),
    );
  });

  it('UT-033 filters from the inclusive cutoff and orders ascending', async () => {
    const since = new Date('2026-08-01T00:00:00.000Z');
    const records = [makeRecord(1), makeRecord(2), makeRecord(3)];
    findMany.mockResolvedValue(records);

    const result = await repository.findByUserSince('user-1', since);

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', recordedAt: { gte: since } },
      orderBy: { recordedAt: 'asc' },
    });
    expect(result).toEqual(records);
  });

  describe('latest record', () => {
    it('UT-001 queries the user latest record ordered by record then creation date', async () => {
      const latest = makeRecord(5);
      findFirst.mockResolvedValue(latest);

      const result = await repository.findLatestByUser('u1');

      expect(findFirst).toHaveBeenCalledTimes(1);
      expect(findFirst).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        orderBy: [{ recordedAt: 'desc' }, { createdAt: 'desc' }],
      });
      expect(result).toBe(latest);
    });

    it('UT-002 returns null when the user has no records', async () => {
      findFirst.mockResolvedValue(null);

      await expect(repository.findLatestByUser('u1')).resolves.toBeNull();
    });
  });
});
