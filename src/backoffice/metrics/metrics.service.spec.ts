import { GatewayError, PaymentGateway } from '@/billing/gateway/paymentGateway';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { MetricsService } from './metrics.service';

function makeUsers(): UserRepository {
  return {
    countRegisteredByRoleAndPlan: jest.fn().mockResolvedValue([
      { role: 'USER', free: 3, premium: 2 },
      { role: 'NUTRITIONIST', free: 1, premium: 5 },
      { role: 'PHYSICAL_EDUCATOR', free: 0, premium: 4 },
      { role: 'ACADEMIA', free: 0, premium: 1 },
    ]),
    countNewRegistrationsThisMonth: jest.fn().mockResolvedValue([
      { role: 'USER', count: 7 },
      { role: 'NUTRITIONIST', count: 0 },
      { role: 'PHYSICAL_EDUCATOR', count: 0 },
      { role: 'ACADEMIA', count: 0 },
    ]),
    countCanceledThisMonth: jest.fn().mockResolvedValue([
      { role: 'USER', count: 1 },
      { role: 'NUTRITIONIST', count: 0 },
      { role: 'PHYSICAL_EDUCATOR', count: 0 },
      { role: 'ACADEMIA', count: 0 },
    ]),
    sumActiveSubscriptionRevenue: jest.fn().mockResolvedValue(1234.5),
    findCohortUsers: jest.fn().mockResolvedValue([]),
    findActivePremiumUsersForLtv: jest.fn().mockResolvedValue([]),
    findRolesWithActivePremiumProduct: jest.fn().mockResolvedValue([]),
  } as unknown as UserRepository;
}

const API_KEY = 'platform-api-key';
const FIXED_NOW = new Date('2026-11-04T12:00:00.000Z');

function makeService(
  options: {
    listPayments?: jest.Mock;
    now?: jest.Mock;
    users?: UserRepository;
  } = {},
) {
  const listPayments = options.listPayments ?? jest.fn().mockResolvedValue(500);
  const now = options.now ?? jest.fn().mockReturnValue(FIXED_NOW);
  const users = options.users ?? makeUsers();
  const gateway = { listPayments } as unknown as PaymentGateway;
  const clock = { now } as unknown as Clock;
  const service = new MetricsService(users, gateway, API_KEY, clock);
  return { service, listPayments, now, users };
}

describe('MetricsService', () => {
  it('UT-013 assembles the full PlatformMetrics shape from the repository and gateway', async () => {
    const { service, listPayments } = makeService();

    const result = await service.getPlatformMetrics();

    expect(result).toEqual({
      mrr: {
        current: 1234.5,
        previousMonth: 500,
        asOf: FIXED_NOW.toISOString(),
      },
      registeredByRole: [
        { role: 'USER', free: 3, premium: 2, newThisMonth: 7 },
        { role: 'NUTRITIONIST', free: 1, premium: 5, newThisMonth: 0 },
        { role: 'PHYSICAL_EDUCATOR', free: 0, premium: 4, newThisMonth: 0 },
        { role: 'ACADEMIA', free: 0, premium: 1, newThisMonth: 0 },
      ],
      churnByRole: [
        { role: 'USER', canceledThisMonth: 1 },
        { role: 'NUTRITIONIST', canceledThisMonth: 0 },
        { role: 'PHYSICAL_EDUCATOR', canceledThisMonth: 0 },
        { role: 'ACADEMIA', canceledThisMonth: 0 },
      ],
      // cohortRetention is always the full zero-filled 12-month × 4-role ×
      // 2-plan grid (96 rows) even with no cohort users — asserted below.
      cohortRetention: result.cohortRetention,
      ltvBySegment: [],
    });
    expect(result.cohortRetention).toHaveLength(12 * 4 * 2); // 96 cells
    expect(result.cohortRetention.every((row) => row.cohortSize === 0)).toBe(
      true,
    );
    expect(listPayments).toHaveBeenCalledWith(API_KEY, expect.anything());
  });

  it('UT-014 sets mrr.previousMonth to null when Asaas throws, without affecting the rest', async () => {
    const listPayments = jest
      .fn()
      .mockRejectedValue(new GatewayError('unavailable', 'down'));
    const { service } = makeService({ listPayments });

    const result = await service.getPlatformMetrics();

    expect(result.mrr.previousMonth).toBeNull();
    expect(result.mrr.current).toBe(1234.5);
    expect(result.registeredByRole).toHaveLength(4);
    expect(result.churnByRole).toHaveLength(4);
  });

  it('UT-015 reuses the cached value within 15 minutes without calling the gateway again', async () => {
    const listPayments = jest.fn().mockResolvedValue(500);
    const now = jest
      .fn()
      .mockReturnValueOnce(FIXED_NOW)
      .mockReturnValueOnce(new Date(FIXED_NOW.getTime() + 10 * 60 * 1000));
    const { service } = makeService({ listPayments, now });

    await service.getPlatformMetrics();
    const second = await service.getPlatformMetrics();

    expect(listPayments).toHaveBeenCalledTimes(1);
    expect(second.mrr.previousMonth).toBe(500);
    expect(second.mrr.asOf).toBe(FIXED_NOW.toISOString());
  });

  it('UT-016 calls the gateway again more than 15 minutes after the last successful call', async () => {
    const listPayments = jest.fn().mockResolvedValue(500);
    const now = jest
      .fn()
      .mockReturnValueOnce(FIXED_NOW)
      .mockReturnValueOnce(new Date(FIXED_NOW.getTime() + 16 * 60 * 1000));
    const { service } = makeService({ listPayments, now });

    await service.getPlatformMetrics();
    await service.getPlatformMetrics();

    expect(listPayments).toHaveBeenCalledTimes(2);
  });

  it('UT-017 never caches a failure — the very next call retries the gateway immediately', async () => {
    const listPayments = jest
      .fn()
      .mockRejectedValueOnce(new GatewayError('unavailable', 'down'))
      .mockResolvedValueOnce(500);
    const { service } = makeService({ listPayments });

    const first = await service.getPlatformMetrics();
    const second = await service.getPlatformMetrics();

    expect(first.mrr.previousMonth).toBeNull();
    expect(second.mrr.previousMonth).toBe(500);
    expect(listPayments).toHaveBeenCalledTimes(2);
  });

  it('UT-019 degrades cohortRetention to [] without throwing when findCohortUsers rejects', async () => {
    const users = makeUsers();
    (users.findCohortUsers as jest.Mock).mockRejectedValue(
      new Error('db down'),
    );
    const { service } = makeService({ users });

    const result = await service.getPlatformMetrics();

    expect(result.cohortRetention).toEqual([]);
    expect(result.registeredByRole).toHaveLength(4);
    expect(result.churnByRole).toHaveLength(4);
  });

  it('UT-020 degrades ltvBySegment to [] without throwing when findActivePremiumUsersForLtv rejects', async () => {
    const users = makeUsers();
    (users.findActivePremiumUsersForLtv as jest.Mock).mockRejectedValue(
      new Error('db down'),
    );
    const { service } = makeService({ users });

    const result = await service.getPlatformMetrics();

    expect(result.ltvBySegment).toEqual([]);
    expect(result.registeredByRole).toHaveLength(4);
    expect(result.churnByRole).toHaveLength(4);
  });
});
