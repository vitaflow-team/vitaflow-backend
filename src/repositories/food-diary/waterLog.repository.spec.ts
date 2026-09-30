import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { WaterLog } from '@prisma/client';
import { WaterLogRepository } from './waterLog.repository';

function makeLog(overrides: Partial<WaterLog> = {}): WaterLog {
  const timestamp = new Date('2026-09-30T00:00:00.000Z');
  return {
    id: 'water-1',
    userId: 'user-1',
    date: timestamp,
    count: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('WaterLogRepository', () => {
  const findUnique = jest.fn();
  const findUniqueOrThrow = jest.fn();
  const upsert = jest.fn();
  const updateMany = jest.fn();
  let repository: WaterLogRepository;
  const date = new Date('2026-09-30T00:00:00.000Z');

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WaterLogRepository,
        {
          provide: PrismaService,
          useValue: {
            waterLog: { findUnique, findUniqueOrThrow, upsert, updateMany },
          },
        },
      ],
    }).compile();
    repository = module.get(WaterLogRepository);
  });

  it('finds a log by user and date', async () => {
    const log = makeLog();
    findUnique.mockResolvedValue(log);

    await expect(repository.findByUserAndDate('user-1', date)).resolves.toBe(
      log,
    );
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId_date: { userId: 'user-1', date } },
    });
  });

  it('increments by creating a row when none exists', async () => {
    const created = makeLog({ count: 1 });
    upsert.mockResolvedValue(created);

    const result = await repository.increment('user-1', date);

    expect(upsert).toHaveBeenCalledWith({
      where: { userId_date: { userId: 'user-1', date } },
      create: { userId: 'user-1', date, count: 1 },
      update: { count: { increment: 1 } },
    });
    expect(result).toBe(created);
  });

  it('decrements an existing positive count', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    const after = makeLog({ count: 2 });
    findUniqueOrThrow.mockResolvedValue(after);

    const result = await repository.decrement('user-1', date);

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', date, count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    });
    expect(result).toBe(after);
  });

  it('decrementing a count of 0 stays at 0, never negative', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    const floored = makeLog({ count: 0 });
    upsert.mockResolvedValue(floored);

    const result = await repository.decrement('user-1', date);

    expect(upsert).toHaveBeenCalledWith({
      where: { userId_date: { userId: 'user-1', date } },
      create: { userId: 'user-1', date, count: 0 },
      update: {},
    });
    expect(result.count).toBe(0);
  });

  it('decrementing when no row exists at all also stays at 0', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    upsert.mockResolvedValue(makeLog({ count: 0 }));

    const result = await repository.decrement('user-1', date);

    expect(result.count).toBe(0);
  });
});
