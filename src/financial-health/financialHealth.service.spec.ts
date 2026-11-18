import type { BillingOwner } from '@/billing/owner/types/billingOwner';
import { resolveBillingOwner } from '@/billing/owner/billingOwnerRules';
import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { FinancialHealthRepository } from '@/repositories/billing/financialHealth.repository';
import type { SummaryFigures } from '@/repositories/billing/types/summaryFigures';
import { Clock } from '@/scheduling/clock.service';
import { ProductTier, ProductType } from '@prisma/client';
import { FinancialHealthService } from './financialHealth.service';

// 2026-11-17 14:00 in Brasília.
const NOW = new Date('2026-11-17T17:00:00Z');

const PROFESSIONAL: BillingOwner = {
  ownerId: 'e1',
  kind: 'PROFESSIONAL',
  academiaId: null,
};

function figures(overrides: Partial<SummaryFigures> = {}): SummaryFigures {
  return {
    current: {
      expectedCents: 100000,
      receivedCents: 60000,
      stillOwedCents: 40000,
    },
    previous: {
      expectedCents: 90000,
      receivedCents: 80000,
      stillOwedCents: 10000,
    },
    overdue: {
      d1to7Cents: 5000,
      d8to30Cents: 3000,
      d31PlusCents: 2000,
      delinquentCount: 3,
    },
    ...overrides,
  };
}

function build(
  overrides: {
    repository?: Partial<Record<keyof FinancialHealthRepository, jest.Mock>>;
    account?: unknown;
    clockAt?: () => Date;
  } = {},
) {
  const repository = {
    summaryFigures: jest.fn().mockResolvedValue(figures()),
    hasAnyInvoice: jest.fn().mockResolvedValue(true),
    countDelinquentClients: jest.fn().mockResolvedValue(3),
    delinquentClients: jest.fn().mockResolvedValue([]),
    ...overrides.repository,
  };
  const accounts = {
    findActiveByUser: jest
      .fn()
      .mockResolvedValue(
        overrides.account === undefined
          ? { apiKeyEncrypted: 'cipher', keyInvalidAt: null }
          : overrides.account,
      ),
  };
  const clock = { now: overrides.clockAt ?? (() => NOW) };
  const service = new FinancialHealthService(
    repository as unknown as FinancialHealthRepository,
    accounts as unknown as BillingAccountRepository,
    clock as unknown as Clock,
  );
  return { service, repository, accounts };
}

describe('FinancialHealthService.summary', () => {
  it('UT-010 carries the repository figures with the professional audience and CONNECTED state', async () => {
    const { service } = build();
    const result = await service.summary(PROFESSIONAL, '2026-11');

    expect(result).toEqual({
      audience: 'PROFESSIONAL',
      billingState: 'CONNECTED',
      hasHistory: true,
      month: '2026-11',
      current: {
        expectedCents: 100000,
        receivedCents: 60000,
        stillOwedCents: 40000,
      },
      previous: {
        expectedCents: 90000,
        receivedCents: 80000,
        stillOwedCents: 10000,
      },
      overdue: {
        totalCents: 10000,
        delinquentCount: 3,
        bands: { d1to7Cents: 5000, d8to30Cents: 3000, d31PlusCents: 2000 },
      },
    });
  });

  it('UT-010 asks the repository for the selected and the previous month and today in Brasília', async () => {
    const { service, repository } = build();
    await service.summary(PROFESSIONAL, '2026-01');

    expect(repository.summaryFigures).toHaveBeenCalledWith({
      ownerId: 'e1',
      current: {
        year: 2026,
        month: 1,
        start: '2026-01-01',
        nextStart: '2026-02-01',
      },
      previous: {
        year: 2025,
        month: 12,
        start: '2025-12-01',
        nextStart: '2026-01-01',
      },
      today: '2026-11-17',
    });
  });

  it('UT-011 no account and no invoices: NOT_CONNECTED without history', async () => {
    const { service } = build({
      account: null,
      repository: { hasAnyInvoice: jest.fn().mockResolvedValue(false) },
    });
    expect(await service.summary(PROFESSIONAL, undefined)).toMatchObject({
      billingState: 'NOT_CONNECTED',
      hasHistory: false,
    });
  });

  it('UT-012 a refused key is RECONNECT_NEEDED and the figures are still returned', async () => {
    const { service } = build({
      account: { apiKeyEncrypted: 'cipher', keyInvalidAt: NOW },
    });
    const result = await service.summary(PROFESSIONAL, '2026-11');
    expect(result.billingState).toBe('RECONNECT_NEEDED');
    expect(result.current.expectedCents).toBe(100000);
  });

  it('UT-013 only disconnected or replaced accounts with invoices: NOT_CONNECTED with history and figures', async () => {
    const { service } = build({ account: null });
    const result = await service.summary(PROFESSIONAL, '2026-11');
    expect(result).toMatchObject({
      billingState: 'NOT_CONNECTED',
      hasHistory: true,
    });
    expect(result.current.receivedCents).toBe(60000);
  });

  it('UT-014 a repository failure is one coded 503, never a partial panel', async () => {
    const { service } = build({
      repository: {
        summaryFigures: jest.fn().mockRejectedValue(new Error('db down')),
      },
    });
    await expect(
      service.summary(PROFESSIONAL, '2026-11'),
    ).rejects.toMatchObject({
      status: 503,
      code: 'financial_data_unavailable',
    });
  });

  it('UT-014 an invalid month is refused before any read', async () => {
    const { service, repository } = build();
    await expect(
      service.summary(PROFESSIONAL, '2026-13'),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_month' });
    expect(repository.summaryFigures).not.toHaveBeenCalled();
  });

  it('UT-017 educators and nutritionists get the professional audience, a gym owner the gym one, always scoped to the owner id', async () => {
    const educator = resolveBillingOwner({
      id: 'u-edu',
      academiaId: null,
      subscriptionStatus: 'active',
      product: {
        type: ProductType.PHYSICAL_EDUCATOR,
        tier: ProductTier.PREMIUM,
      },
    });
    const nutritionist = resolveBillingOwner({
      id: 'u-nut',
      academiaId: null,
      subscriptionStatus: 'active',
      product: { type: ProductType.NUTRITIONIST, tier: ProductTier.PREMIUM },
    });
    const gym = resolveBillingOwner({
      id: 'u-gym',
      academiaId: 'a1',
      subscriptionStatus: 'active',
      product: { type: ProductType.ACADEMIA, tier: ProductTier.STANDARD },
    });

    for (const [owner, audience] of [
      [educator, 'PROFESSIONAL'],
      [nutritionist, 'PROFESSIONAL'],
      [gym, 'GYM'],
    ] as const) {
      const { service, repository, accounts } = build();
      expect((await service.summary(owner, '2026-11')).audience).toBe(audience);
      expect(repository.summaryFigures).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: owner.ownerId }),
      );
      expect(repository.hasAnyInvoice).toHaveBeenCalledWith(owner.ownerId);
      expect(accounts.findActiveByUser).toHaveBeenCalledWith(owner.ownerId);
    }
  });

  it('UT-018 an empty connected panel is zeros with no history, and no NaN or null anywhere', async () => {
    const zero = { expectedCents: 0, receivedCents: 0, stillOwedCents: 0 };
    const { service } = build({
      repository: {
        summaryFigures: jest.fn().mockResolvedValue(
          figures({
            current: zero,
            previous: zero,
            overdue: {
              d1to7Cents: 0,
              d8to30Cents: 0,
              d31PlusCents: 0,
              delinquentCount: 0,
            },
          }),
        ),
        hasAnyInvoice: jest.fn().mockResolvedValue(false),
      },
    });
    const result = await service.summary(PROFESSIONAL, '2026-11');

    expect(result).toMatchObject({
      billingState: 'CONNECTED',
      hasHistory: false,
      current: zero,
      previous: zero,
      overdue: { totalCents: 0, delinquentCount: 0 },
    });
    const numbers: unknown[] = [];
    JSON.stringify(result, (_key, value: unknown) => {
      if (typeof value === 'number' || value === null) numbers.push(value);
      return value;
    });
    expect(numbers.every((value) => Number.isFinite(value))).toBe(true);
  });
});

describe('FinancialHealthService.delinquents', () => {
  it('UT-015 a page past the end is the last page (offset 40 of 45)', async () => {
    const { service, repository } = build({
      repository: { countDelinquentClients: jest.fn().mockResolvedValue(45) },
    });
    const result = await service.delinquents(PROFESSIONAL, '9');

    expect(result).toMatchObject({ page: 3, pageSize: 20, total: 45 });
    expect(repository.delinquentClients).toHaveBeenCalledWith({
      ownerId: 'e1',
      today: '2026-11-17',
      limit: 20,
      offset: 40,
    });
  });

  it.each(['0', '-2', 'abc', '1.5', '', undefined])(
    'UT-016 page %p resolves to page 1',
    async (raw) => {
      const { service, repository } = build();
      const result = await service.delinquents(PROFESSIONAL, raw);
      expect(result.page).toBe(1);
      expect(repository.delinquentClients).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 0 }),
      );
    },
  );

  it('an empty list is page 1 of 0 rows', async () => {
    const { service } = build({
      repository: { countDelinquentClients: jest.fn().mockResolvedValue(0) },
    });
    expect(await service.delinquents(PROFESSIONAL, '4')).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
  });

  it('UT-014 a repository failure on the list is the same coded 503', async () => {
    const { service } = build({
      repository: {
        countDelinquentClients: jest.fn().mockRejectedValue(new Error('x')),
      },
    });
    await expect(service.delinquents(PROFESSIONAL, '1')).rejects.toMatchObject({
      status: 503,
      code: 'financial_data_unavailable',
    });
  });
});
