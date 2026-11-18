import { BackofficeAccessLogRepository } from '@/repositories/backoffice/backofficeAccessLog.repository';
import { PlatformFinancialRepository } from '@/repositories/billing/platformFinancial.repository';
import type { MonthTotals } from '@/repositories/billing/types/monthTotals';
import type { PlatformDelinquentRow } from '@/repositories/billing/types/platformDelinquentRow';
import type { PlatformFigures } from '@/repositories/billing/types/platformFigures';
import type { PlatformSummaryFigures } from '@/repositories/billing/types/platformSummaryFigures';
import type { PlatformSummaryQuery } from '@/repositories/billing/types/platformSummaryQuery';
import { Clock } from '@/scheduling/clock.service';
import { Logger } from '@nestjs/common';
import {
  BackofficeAccessResource,
  BackofficeTier,
  PlatformPaymentStatus,
  ProductType,
} from '@prisma/client';
import { PlatformFinancialService } from './platformFinancial.service';

const NOW = new Date('2026-11-17T15:00:00Z'); // 12:00 in Brasília
const TODAY = '2026-11-17';
const S = PlatformPaymentStatus;
const ADMIN = { id: 'staff-1', backofficeTier: BackofficeTier.ADMIN };
const EQUIPE = { id: 'staff-2', backofficeTier: BackofficeTier.EQUIPE };

interface Row {
  userId: string;
  name?: string;
  type?: ProductType;
  plan?: string;
  valueCents: number;
  status: PlatformPaymentStatus;
  dueDate: string;
  paidAt?: string;
  paidAmountCents?: number;
  updatedAt?: string;
}

const TYPES = Object.values(ProductType);

function totals(rows: Row[], start: string, nextStart: string): MonthTotals {
  const counted = rows.filter(
    (r) => r.status !== S.REFUNDED && r.status !== S.CANCELED,
  );
  const open = (r: Row) => r.status === S.PENDING || r.status === S.OVERDUE;
  const sum = (list: Row[], pick: (r: Row) => number) =>
    list.reduce((total, r) => total + pick(r), 0);
  const dueIn = (r: Row) => r.dueDate >= start && r.dueDate < nextStart;
  const paidIn = (r: Row) =>
    r.status === S.PAID && r.paidAt! >= start && r.paidAt! < nextStart;
  return {
    expectedCents: sum(counted.filter(dueIn), (r) => r.valueCents),
    receivedCents: sum(
      counted.filter(paidIn),
      (r) => r.paidAmountCents ?? r.valueCents,
    ),
    stillOwedCents: sum(
      counted.filter((r) => open(r) && dueIn(r)),
      (r) => r.valueCents,
    ),
  };
}

function daysOverdue(row: Row): number {
  return Math.round((Date.parse(TODAY) - Date.parse(row.dueDate)) / 86_400_000);
}

function isOverdue(row: Row): boolean {
  return (
    (row.status === S.PENDING || row.status === S.OVERDUE) &&
    row.dueDate < TODAY
  );
}

function figuresOf(rows: Row[], query: PlatformSummaryQuery): PlatformFigures {
  const late = rows.filter(isOverdue);
  const bandSum = (from: number, to: number) =>
    late
      .filter((r) => daysOverdue(r) >= from && daysOverdue(r) <= to)
      .reduce((total, r) => total + r.valueCents, 0);
  return {
    current: totals(rows, query.current.start, query.current.nextStart),
    previous: totals(rows, query.previous.start, query.previous.nextStart),
    overdue: {
      d1to7Cents: bandSum(1, 7),
      d8to30Cents: bandSum(8, 30),
      d31PlusCents: bandSum(31, Infinity),
      delinquentCount: new Set(late.map((r) => r.userId)).size,
    },
  };
}

// An in-memory payment table that answers like the SQL repository does, so
// the service's definitions are exercised against real rows.
function fakeTable(initial: Row[] = []) {
  let rows = [...initial];
  const byUser = () => {
    const groups = new Map<string, Row[]>();
    for (const row of rows.filter(isOverdue)) {
      groups.set(row.userId, [...(groups.get(row.userId) ?? []), row]);
    }
    return [...groups.values()].map((list) =>
      list.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    );
  };
  const repository = {
    earliestDueDate: jest.fn(() =>
      Promise.resolve(rows.map((r) => r.dueDate).sort()[0] ?? null),
    ),
    lastSyncedAt: jest.fn(() =>
      Promise.resolve(
        rows.length === 0 ? null : new Date('2026-11-17T06:00:00Z'),
      ),
    ),
    summaryFigures: jest.fn((query: PlatformSummaryQuery) =>
      Promise.resolve({
        total: figuresOf(rows, query),
        byAccountType: Object.fromEntries(
          TYPES.map((type) => [
            type,
            figuresOf(
              rows.filter((r) => (r.type ?? ProductType.USER) === type),
              query,
            ),
          ]),
        ) as PlatformSummaryFigures['byAccountType'],
      }),
    ),
    delinquentCounts: jest.fn(() => {
      const bandOf = (list: Row[]) => daysOverdue(list[0]);
      const days = byUser().map(bandOf);
      return Promise.resolve({
        total: days.length,
        d1to7: days.filter((d) => d <= 7).length,
        d8to30: days.filter((d) => d > 7 && d <= 30).length,
        d31Plus: days.filter((d) => d > 30).length,
      });
    }),
    delinquentUsers: jest.fn(
      (query: {
        limit: number;
        offset: number;
      }): Promise<PlatformDelinquentRow[]> => {
        const users = byUser().map((list) => ({
          userId: list[0].userId,
          name: list[0].name ?? list[0].userId,
          accountType: list[0].type ?? ProductType.USER,
          planName: list[0].plan ?? 'Premium',
          totalOwedCents: list.reduce((total, r) => total + r.valueCents, 0),
          oldestDaysOverdue: daysOverdue(list[0]),
        }));
        users.sort(
          (a, b) =>
            b.totalOwedCents - a.totalOwedCents ||
            b.oldestDaysOverdue - a.oldestDaysOverdue ||
            a.name.localeCompare(b.name),
        );
        return Promise.resolve(
          users.slice(query.offset, query.offset + query.limit),
        );
      },
    ),
  };
  return {
    repository,
    deleteUser(userId: string) {
      rows = rows.filter((r) => r.userId !== userId);
    },
  };
}

function build(rows: Row[] = [], accessLogCreate?: jest.Mock) {
  const table = fakeTable(rows);
  const accessLog = {
    create: accessLogCreate ?? jest.fn().mockResolvedValue(undefined),
  };
  const service = new PlatformFinancialService(
    table.repository as unknown as PlatformFinancialRepository,
    accessLog as unknown as BackofficeAccessLogRepository,
    { now: () => NOW } as Clock,
  );
  return { service, table, accessLog };
}

function noRepositoryCall(table: ReturnType<typeof fakeTable>) {
  for (const fn of Object.values(table.repository)) {
    expect(fn).not.toHaveBeenCalled();
  }
}

describe('PlatformFinancialService.summary', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('UT-114 shows expected, received and still owed per account type, and the totals are the sums', async () => {
    const { service } = build([
      {
        userId: 'u1',
        type: ProductType.USER,
        valueCents: 14990,
        status: S.PAID,
        dueDate: '2026-11-05',
        paidAt: '2026-11-05',
      },
      {
        userId: 'u2',
        type: ProductType.PHYSICAL_EDUCATOR,
        valueCents: 9990,
        status: S.PENDING,
        dueDate: '2026-11-25',
      },
    ]);

    const result = await service.summary('2026-11');

    expect(result.available).toBe(true);
    expect(result.byAccountType![ProductType.USER]).toEqual({
      expectedCents: 14990,
      receivedCents: 14990,
      stillOwedCents: 0,
    });
    expect(result.byAccountType![ProductType.PHYSICAL_EDUCATOR]).toEqual({
      expectedCents: 9990,
      receivedCents: 0,
      stillOwedCents: 9990,
    });
    expect(result.byAccountType![ProductType.NUTRITIONIST]).toEqual({
      expectedCents: 0,
      receivedCents: 0,
      stillOwedCents: 0,
    });
    expect(result.totals).toEqual({
      expectedCents: 24980,
      receivedCents: 14990,
      stillOwedCents: 9990,
    });
    expect(result.month).toBe('2026-11');
  });

  it('UT-115 counts both November payments of a user who changed plan mid-month', async () => {
    const { service } = build([
      {
        userId: 'u1',
        valueCents: 9990,
        status: S.PAID,
        dueDate: '2026-11-02',
        paidAt: '2026-11-02',
      },
      {
        userId: 'u1',
        valueCents: 14990,
        status: S.PENDING,
        dueDate: '2026-11-20',
      },
    ]);

    const result = await service.summary('2026-11');

    expect(result.totals?.expectedCents).toBe(24980);
  });

  it('UT-116 keeps counting a pending payment in still owed after the subscription was canceled', async () => {
    const { service } = build([
      {
        userId: 'u1',
        valueCents: 14990,
        status: S.PENDING,
        dueDate: '2026-11-25',
      },
    ]);

    const result = await service.summary('2026-11');

    expect(result.totals?.stillOwedCents).toBe(14990);
  });

  it('UT-117 leaves refunded and canceled payments out of expected, received, still owed and overdue', async () => {
    const { service } = build([
      {
        userId: 'u1',
        valueCents: 5000,
        status: S.REFUNDED,
        dueDate: '2026-11-05',
        paidAt: '2026-11-05',
      },
      {
        userId: 'u2',
        valueCents: 6000,
        status: S.CANCELED,
        dueDate: '2026-11-06',
      },
      {
        userId: 'u3',
        valueCents: 7000,
        status: S.CANCELED,
        dueDate: '2026-11-01',
      },
    ]);

    const result = await service.summary('2026-11');

    expect(result.totals).toEqual({
      expectedCents: 0,
      receivedCents: 0,
      stillOwedCents: 0,
    });
    expect(result.overdue.totalCents).toBe(0);
    expect(result.overdue.delinquentCount).toBe(0);
  });

  it('UT-118 puts overdue and past-due pending payments in the bands per account type, never one due today', async () => {
    const { service } = build([
      {
        userId: 'u1',
        type: ProductType.USER,
        valueCents: 1000,
        status: S.OVERDUE,
        dueDate: '2026-11-12',
      },
      {
        userId: 'u2',
        type: ProductType.USER,
        valueCents: 2000,
        status: S.PENDING,
        dueDate: '2026-10-20',
      },
      {
        userId: 'u3',
        type: ProductType.ACADEMIA,
        valueCents: 4000,
        status: S.OVERDUE,
        dueDate: '2026-09-01',
      },
      {
        userId: 'u4',
        type: ProductType.USER,
        valueCents: 8000,
        status: S.PENDING,
        dueDate: TODAY,
      },
    ]);

    const result = await service.summary('2026-11');

    expect(result.overdue).toMatchObject({
      totalCents: 7000,
      delinquentCount: 3,
      bands: { d1to7Cents: 1000, d8to30Cents: 2000, d31PlusCents: 4000 },
    });
    expect(result.overdue.byAccountType[ProductType.USER]).toMatchObject({
      totalCents: 3000,
      delinquentCount: 2,
    });
    expect(result.overdue.byAccountType[ProductType.ACADEMIA]).toMatchObject({
      totalCents: 4000,
      delinquentCount: 1,
      bands: { d31PlusCents: 4000 },
    });
  });

  it('UT-119 marks a month before the first stored payment as unavailable, with no figures', async () => {
    const { service } = build([
      {
        userId: 'u1',
        valueCents: 14990,
        status: S.PAID,
        dueDate: '2026-09-10',
        paidAt: '2026-09-10',
      },
    ]);

    const result = await service.summary('2026-08');

    expect(result).toMatchObject({
      month: '2026-08',
      available: false,
      totals: null,
      byAccountType: null,
      previous: null,
    });
  });

  it("UT-119 keeps showing today's overdue even when the selected month is unavailable", async () => {
    const { service } = build([
      {
        userId: 'u1',
        valueCents: 3000,
        status: S.OVERDUE,
        dueDate: '2026-10-01',
      },
    ]);

    const result = await service.summary('2025-12');

    expect(result.available).toBe(false);
    expect(result.overdue.totalCents).toBe(3000);
  });

  it('UT-120 has no previous month when it falls before the first stored payment', async () => {
    const { service } = build([
      {
        userId: 'u1',
        valueCents: 14990,
        status: S.PAID,
        dueDate: '2026-09-10',
        paidAt: '2026-09-10',
      },
    ]);

    const first = await service.summary('2026-09');
    const second = await service.summary('2026-10');

    expect(first.available).toBe(true);
    expect(first.previous).toBeNull();
    expect(second.previous).toMatchObject({
      month: '2026-09',
      totals: { expectedCents: 14990, receivedCents: 14990 },
    });
  });

  it('UT-126 refuses an invalid or future month with 400 invalid_month', async () => {
    const { service, table } = build();

    for (const month of ['2026-13', '2026-12', '2025-10', 'abc', '26-1']) {
      await expect(service.summary(month)).rejects.toMatchObject({
        status: 400,
        code: 'invalid_month',
      });
    }
    noRepositoryCall(table);
  });

  it('UT-127 shows zeros for the current month when nothing was ever paid, and an empty list', async () => {
    const { service } = build();

    const summary = await service.summary(undefined);
    const list = await service.delinquents(ADMIN, undefined);

    expect(summary).toMatchObject({
      month: '2026-11',
      available: true,
      syncedAt: null,
      totals: { expectedCents: 0, receivedCents: 0, stillOwedCents: 0 },
      previous: null,
    });
    expect(summary.overdue.totalCents).toBe(0);
    expect(list).toMatchObject({ items: [], total: 0, page: 1 });
  });

  it('UT-127 calls a past month unavailable while nothing is stored', async () => {
    const { service } = build();

    const result = await service.summary('2026-10');

    expect(result.available).toBe(false);
  });

  it('UT-125 does not count the payments of a deleted user', async () => {
    const { service, table } = build([
      {
        userId: 'gone',
        valueCents: 9000,
        status: S.OVERDUE,
        dueDate: '2026-11-01',
      },
      {
        userId: 'stays',
        valueCents: 1000,
        status: S.OVERDUE,
        dueDate: '2026-11-01',
      },
    ]);
    table.deleteUser('gone');

    const summary = await service.summary('2026-11');
    const list = await service.delinquents(ADMIN, '1');

    expect(summary.overdue.totalCents).toBe(1000);
    expect(list.items.map((item) => item.userId)).toEqual(['stays']);
  });

  it('UT-129 keeps a user overdue while the payment stays OVERDUE, until it is PAID or CANCELED', async () => {
    const overdueRow: Row = {
      userId: 'u1',
      valueCents: 14990,
      status: S.OVERDUE,
      dueDate: '2026-10-20',
    };
    const open = build([overdueRow]);
    const paid = build([
      { ...overdueRow, status: S.PAID, paidAt: '2026-11-10' },
    ]);
    const canceled = build([{ ...overdueRow, status: S.CANCELED }]);

    expect((await open.service.delinquents(ADMIN, '1')).total).toBe(1);
    expect((await paid.service.delinquents(ADMIN, '1')).total).toBe(0);
    expect((await canceled.service.delinquents(ADMIN, '1')).total).toBe(0);
  });

  it('reports when the table was last written to', async () => {
    const { service } = build([
      {
        userId: 'u1',
        valueCents: 1000,
        status: S.PENDING,
        dueDate: '2026-11-25',
      },
    ]);

    const result = await service.summary('2026-11');

    expect(result.syncedAt).toBe('2026-11-17T06:00:00.000Z');
  });
});

describe('PlatformFinancialService.delinquents', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('UT-121 orders by amount owed, then oldest overdue, then name, with exactly the minimum fields', async () => {
    const { service } = build([
      {
        userId: 'a',
        name: 'Bruno',
        plan: 'Premium',
        valueCents: 5000,
        status: S.OVERDUE,
        dueDate: '2026-11-10',
      },
      {
        userId: 'b',
        name: 'Ana',
        plan: 'Premium',
        valueCents: 5000,
        status: S.OVERDUE,
        dueDate: '2026-11-10',
      },
      {
        userId: 'c',
        name: 'Caio',
        plan: 'Gratuito',
        valueCents: 5000,
        status: S.OVERDUE,
        dueDate: '2026-10-01',
      },
      {
        userId: 'd',
        name: 'Davi',
        plan: 'Pro',
        type: ProductType.NUTRITIONIST,
        valueCents: 9000,
        status: S.PENDING,
        dueDate: '2026-11-16',
      },
    ]);

    const result = await service.delinquents(ADMIN, '1');

    expect(result.items.map((item) => item.userId)).toEqual([
      'd',
      'c',
      'b',
      'a',
    ]);
    expect(Object.keys(result.items[0]).sort()).toEqual([
      'accountType',
      'name',
      'oldestDaysOverdue',
      'planName',
      'totalOwedCents',
      'userId',
    ]);
    expect(result.items[0]).toEqual({
      userId: 'd',
      name: 'Davi',
      accountType: ProductType.NUTRITIONIST,
      planName: 'Pro',
      totalOwedCents: 9000,
      oldestDaysOverdue: 1,
    });
  });

  it('UT-122 answers 503 access_log_failed and reads nothing when the access log cannot be written', async () => {
    const { service, table } = build(
      [
        {
          userId: 'a',
          valueCents: 5000,
          status: S.OVERDUE,
          dueDate: '2026-11-10',
        },
      ],
      jest.fn().mockRejectedValue(new Error('insert failed')),
    );

    await expect(service.delinquents(ADMIN, '1')).rejects.toMatchObject({
      status: 503,
      code: 'access_log_failed',
    });

    noRepositoryCall(table);
  });

  it('UT-123 writes the access log row, with who, tier and page, before reading the list', async () => {
    const order: string[] = [];
    const create = jest.fn().mockImplementation(() => {
      order.push('log');
      return Promise.resolve();
    });
    const { service, table } = build(
      [
        {
          userId: 'a',
          valueCents: 5000,
          status: S.OVERDUE,
          dueDate: '2026-11-10',
        },
      ],
      create,
    );
    table.repository.delinquentCounts.mockImplementationOnce(() => {
      order.push('read');
      return Promise.resolve({ total: 1, d1to7: 1, d8to30: 0, d31Plus: 0 });
    });

    await service.delinquents(ADMIN, '2');

    expect(create).toHaveBeenCalledWith({
      staffUserId: 'staff-1',
      tier: BackofficeTier.ADMIN,
      resource: BackofficeAccessResource.FINANCIAL_DELINQUENT_LIST,
      page: 2,
    });
    expect(order).toEqual(['log', 'read']);
  });

  it('UT-124 answers with the tier of the caller and the band counts for both tiers', async () => {
    const rows: Row[] = [
      {
        userId: 'a',
        valueCents: 1000,
        status: S.OVERDUE,
        dueDate: '2026-11-15',
      },
      {
        userId: 'b',
        valueCents: 1000,
        status: S.OVERDUE,
        dueDate: '2026-11-01',
      },
      {
        userId: 'c',
        valueCents: 1000,
        status: S.OVERDUE,
        dueDate: '2026-09-01',
      },
    ];
    const { service } = build(rows);

    const equipe = await service.delinquents(EQUIPE, '1');
    const admin = await service.delinquents(ADMIN, '1');

    expect(equipe.tier).toBe(BackofficeTier.EQUIPE);
    expect(admin.tier).toBe(BackofficeTier.ADMIN);
    expect(equipe.bandCounts).toEqual({ d1to7: 1, d8to30: 1, d31Plus: 1 });
    expect(admin.bandCounts).toEqual(equipe.bandCounts);
    expect(equipe).not.toHaveProperty('totals');
    expect(Object.keys(equipe).sort()).toEqual([
      'bandCounts',
      'items',
      'page',
      'pageSize',
      'tier',
      'total',
    ]);
  });

  it('treats a staff row without a tier as EQUIPE, in the answer and in the log', async () => {
    const { service, accessLog } = build();

    const result = await service.delinquents(
      { id: 'staff-3', backofficeTier: null },
      '1',
    );

    expect(result.tier).toBe(BackofficeTier.EQUIPE);
    expect(accessLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ tier: BackofficeTier.EQUIPE }),
    );
  });

  it('UT-128 returns the last valid page when the page is beyond the end, and logs the page asked for', async () => {
    const rows: Row[] = Array.from({ length: 45 }, (_, i) => ({
      userId: `u${String(i).padStart(2, '0')}`,
      name: `Nome ${String(i).padStart(2, '0')}`,
      valueCents: 1000 + i,
      status: S.OVERDUE,
      dueDate: '2026-11-10',
    }));
    const { service, accessLog } = build(rows);

    const result = await service.delinquents(ADMIN, '9');

    expect(result).toMatchObject({ page: 3, pageSize: 20, total: 45 });
    expect(result.items).toHaveLength(5);
    expect(accessLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ page: 9 }),
    );
  });

  it.each(['0', '-2', 'abc', undefined])(
    'treats the page %s as page 1',
    async (raw) => {
      const { service, accessLog } = build();

      const result = await service.delinquents(ADMIN, raw);

      expect(result.page).toBe(1);
      expect(accessLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1 }),
      );
    },
  );
});
