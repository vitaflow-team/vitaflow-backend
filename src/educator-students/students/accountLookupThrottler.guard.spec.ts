import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { AccountLookupThrottlerGuard } from './accountLookupThrottler.guard';

type Tracker = { getTracker(req: Record<string, unknown>): Promise<string> };

describe('AccountLookupThrottlerGuard', () => {
  const guard = new AccountLookupThrottlerGuard(
    { throttlers: [{ ttl: 60_000, limit: 10 }] },
    new ThrottlerStorageService(),
    new Reflector(),
  ) as unknown as Tracker;

  it('UT-100 keys the limit by the authenticated educator', async () => {
    const a = await guard.getTracker({
      user: { id: 'educator-1' },
      ip: '1.1.1.1',
    });
    const b = await guard.getTracker({
      user: { id: 'educator-1' },
      ip: '2.2.2.2',
    });
    const other = await guard.getTracker({
      user: { id: 'educator-2' },
      ip: '1.1.1.1',
    });

    expect(a).toBe('educator-lookup:educator-1');
    expect(b).toBe(a);
    expect(other).toBe('educator-lookup:educator-2');
  });

  it('falls back to the address only when no user is present', async () => {
    expect(await guard.getTracker({ ip: '3.3.3.3' })).toBe('ip:3.3.3.3');
  });
});
