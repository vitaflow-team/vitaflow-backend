import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerModuleOptions,
  ThrottlerStorage,
  ThrottlerStorageRecord,
} from '@nestjs/throttler';
import { DualBucketThrottlerGuard } from './dual-bucket-throttler.guard';

class TestGuard extends DualBucketThrottlerGuard {
  tracker(req: Record<string, unknown>) {
    return this.getTracker(req);
  }
}

describe('DualBucketThrottlerGuard', () => {
  const options: ThrottlerModuleOptions = [{ ttl: 60_000, limit: 5 }];
  let counts: Map<string, number>;
  let guard: TestGuard;
  const handler = () => undefined;
  class Controller {}

  beforeEach(async () => {
    counts = new Map();
    const storage: ThrottlerStorage = {
      increment: jest
        .fn()
        .mockImplementation(
          (
            key: string,
            _ttl: number,
            limit: number,
          ): Promise<ThrottlerStorageRecord> => {
            const totalHits = (counts.get(key) ?? 0) + 1;
            counts.set(key, totalHits);
            return Promise.resolve({
              totalHits,
              timeToExpire: 60,
              isBlocked: totalHits > limit,
              timeToBlockExpire: totalHits > limit ? 60 : 0,
            });
          },
        ),
    };
    guard = new TestGuard(options, storage, new Reflector());
    await guard.onModuleInit();
  });

  function context(ip: string, body: unknown): ExecutionContext {
    const response = { header: jest.fn() };
    return {
      getHandler: () => handler,
      getClass: () => Controller,
      switchToHttp: () => ({
        getRequest: () => ({ ip, body, headers: {}, socket: {} }),
        getResponse: () => response,
        getNext: jest.fn(),
      }),
    } as unknown as ExecutionContext;
  }

  it('UT-035 allows a fresh IP and identity under the configured limit', async () => {
    await expect(
      guard.canActivate(context('10.0.0.1', { email: 'a@example.com' })),
    ).resolves.toBe(true);
  });

  it('UT-036 rejects the sixth request from one IP across different identities', async () => {
    for (let index = 0; index < 5; index += 1) {
      await expect(
        guard.canActivate(
          context('10.0.0.1', { email: `user-${index}@example.com` }),
        ),
      ).resolves.toBe(true);
    }
    await expect(
      guard.canActivate(context('10.0.0.1', { email: 'sixth@example.com' })),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('UT-037 rejects the sixth normalized identity across different IPs', async () => {
    for (let index = 0; index < 5; index += 1) {
      await expect(
        guard.canActivate(
          context(`10.0.0.${index}`, { email: 'same@example.com' }),
        ),
      ).resolves.toBe(true);
    }
    await expect(
      guard.canActivate(context('10.0.0.6', { email: 'same@example.com' })),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('UT-038 normalizes email casing to one identity tracker', async () => {
    await expect(
      guard.tracker({ ip: '10.0.0.1', body: { email: 'User@Example.com' } }),
    ).resolves.toBe('identity:user@example.com');
    await expect(
      guard.tracker({ ip: '10.0.0.2', body: { email: 'user@example.com' } }),
    ).resolves.toBe('identity:user@example.com');
  });

  it('UT-039 falls back to IP-only tracking for a malformed body', async () => {
    await expect(guard.tracker({ ip: '10.0.0.7', body: null })).resolves.toBe(
      'ip:10.0.0.7',
    );
    await expect(guard.canActivate(context('10.0.0.7', null))).resolves.toBe(
      true,
    );
  });
});
