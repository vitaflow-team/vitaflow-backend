import { FixedTimesRepository } from './fixedTimes.repository';

describe('FixedTimesRepository (UT-096)', () => {
  it('takes a transaction-level advisory lock keyed by the educator before running the work', async () => {
    const calls: string[] = [];
    const tx = {
      $executeRaw: jest.fn((strings: TemplateStringsArray, key: string) => {
        calls.push(`lock:${strings.join('?')}:${key}`);
        return Promise.resolve(0);
      }),
    };
    const prisma = {
      $transaction: jest.fn(
        async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
      ),
    };
    const repo = new FixedTimesRepository(prisma as never);

    const result = await repo.withEducatorLock('educator-7', () => {
      calls.push('work');
      return Promise.resolve('done');
    });

    expect(result).toBe('done');
    expect(calls[0]).toContain('pg_advisory_xact_lock');
    expect(calls[0]).toContain('educator-schedule:educator-7');
    expect(calls[1]).toBe('work');
  });
});

describe('FixedTimesRepository.findLatestNonCanceledByClient', () => {
  it('queries non-canceled sessions of the professional, newest first, and keeps only the first row per client', async () => {
    const newest = new Date('2026-11-05T12:00:00Z');
    const older = new Date('2026-10-01T12:00:00Z');
    const findMany = jest.fn().mockResolvedValue([
      { clientId: 'client-1', startAt: newest },
      { clientId: 'client-1', startAt: older },
      { clientId: 'client-2', startAt: older },
    ]);
    const prisma = { fixedSession: { findMany } };
    const repo = new FixedTimesRepository(prisma as never);

    const result = await repo.findLatestNonCanceledByClient('educator-1');

    expect(findMany).toHaveBeenCalledWith({
      where: { professionalId: 'educator-1', status: { not: 'CANCELED' } },
      select: { clientId: true, startAt: true },
      orderBy: { startAt: 'desc' },
    });
    expect(result.get('client-1')).toBe(newest);
    expect(result.get('client-2')).toBe(older);
  });

  it('returns an empty map when the professional has no non-canceled sessions', async () => {
    const prisma = {
      fixedSession: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const repo = new FixedTimesRepository(prisma as never);

    const result = await repo.findLatestNonCanceledByClient('educator-1');

    expect(result.size).toBe(0);
  });
});
