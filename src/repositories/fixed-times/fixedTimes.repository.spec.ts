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
