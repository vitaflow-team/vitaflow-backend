import {
  GatewayError,
  PAYMENT_ITEMS_PAGE_SIZE,
} from '@/billing/gateway/paymentGateway';
import type { PaymentGateway } from '@/billing/gateway/paymentGateway';
import type { GatewayPaymentItem } from '@/billing/gateway/types/gatewayPaymentItem';
import type { PaymentItemFilter } from '@/billing/gateway/types/paymentItemFilter';
import { PlatformPaymentRepository } from '@/repositories/billing/platformPayment.repository';
import type { PlatformPaymentData } from '@/repositories/billing/types/platformPaymentData';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { Logger } from '@nestjs/common';
import { ProductType } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { PlatformPaymentIngest } from './platformPaymentIngest.service';
import { PlatformPaymentSync } from './platformPaymentSync.service';

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

// The key the real @Cron decorator writes (the unit-test stub records it too).
const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';
const KEY = 'platform-key';
const NOW = new Date('2026-11-17T15:00:00Z');

function payment(index: number, overrides: Partial<GatewayPaymentItem> = {}) {
  return {
    id: `pay_${index}`,
    customer: 'cus_1',
    subscription: 'sub_1',
    valueCents: 14990,
    status: 'PENDING',
    dueDate: '2026-11-20',
    paymentDate: null,
    deleted: false,
    ...overrides,
  } satisfies GatewayPaymentItem;
}

function payments(count: number, overrides = {}): GatewayPaymentItem[] {
  return Array.from({ length: count }, (_, i) => payment(i + 1, overrides));
}

// A gateway that serves `all` page by page like the real listing, failing when
// asked to for a given offset.
function build(all: GatewayPaymentItem[], failAtOffset?: number) {
  const table = new Map<string, PlatformPaymentData>();
  const listPaymentItems = jest.fn(
    (_key: string, filter: PaymentItemFilter) => {
      if (filter.offset === failAtOffset) {
        return Promise.reject(new GatewayError('unavailable', 'fora do ar'));
      }
      return Promise.resolve(
        all.slice(filter.offset, filter.offset + PAYMENT_ITEMS_PAGE_SIZE),
      );
    },
  );
  const repository = {
    upsertMany: jest.fn((rows: PlatformPaymentData[]) => {
      let created = 0;
      for (const row of rows) {
        if (!table.has(row.asaasPaymentId)) created += 1;
        table.set(row.asaasPaymentId, row);
      }
      return Promise.resolve({ created, updated: rows.length - created });
    }),
    cancelMany: jest.fn().mockResolvedValue(0),
  };
  const users = {
    findSubscribersByCustomerIds: jest.fn().mockResolvedValue([
      {
        id: 'user-1',
        asaasCustomerId: 'cus_1',
        product: { type: ProductType.USER, name: 'Premium' },
      },
    ]),
  };
  const clock = { now: () => NOW } as Clock;
  const ingest = new PlatformPaymentIngest(
    users as unknown as UserRepository,
    repository as unknown as PlatformPaymentRepository,
    clock,
  );
  const sync = new PlatformPaymentSync(
    { listPaymentItems } as unknown as PaymentGateway,
    KEY,
    ingest,
    clock,
  );
  return { sync, table, listPaymentItems, repository };
}

describe('PlatformPaymentSync', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.mocked(Sentry.captureException).mockClear();
  });
  afterEach(() => jest.restoreAllMocks());

  it('UT-109 upserts a payment missing from the table and asks only for the rolling window', async () => {
    const { sync, table, listPaymentItems } = build(payments(1));

    const summary = await sync.run();

    expect(table.has('pay_1')).toBe(true);
    expect(summary).toMatchObject({ ok: true, fetched: 1, upserted: 1 });
    expect(listPaymentItems).toHaveBeenCalledTimes(1);
    expect(listPaymentItems).toHaveBeenCalledWith(KEY, {
      dueFrom: '2026-09-18',
      dueTo: '2026-12-17',
      offset: 0,
    });
  });

  it('UT-110 backfills three pages of 100, 100 and 37 and a second run adds no row', async () => {
    const { sync, table, listPaymentItems } = build(payments(237));

    const first = await sync.backfill();
    const second = await sync.backfill();

    expect(first).toMatchObject({ ok: true, pages: 3, fetched: 237 });
    expect(first.upserted).toBe(237);
    expect(table.size).toBe(237);
    expect(second).toMatchObject({ ok: true, fetched: 237 });
    expect(table.size).toBe(237);
    const offsets = listPaymentItems.mock.calls.map(
      ([, filter]) => filter.offset,
    );
    expect(offsets.slice(0, 3)).toEqual([0, 100, 200]);
    expect(listPaymentItems.mock.calls[0][1]).not.toHaveProperty('dueFrom');
  });

  it('asks for one more page when the last one is exactly full', async () => {
    const { sync, listPaymentItems } = build(payments(100));

    const summary = await sync.backfill();

    expect(summary.pages).toBe(2);
    expect(listPaymentItems).toHaveBeenCalledTimes(2);
  });

  it('UT-111 keeps the first page, deletes nothing and returns a failure summary when page 2 fails', async () => {
    const { sync, table, repository } = build(payments(250), 100);

    const summary = await sync.run();

    expect(summary).toMatchObject({
      ok: false,
      pages: 1,
      fetched: 100,
      upserted: 100,
      failedAtOffset: 100,
    });
    expect(table.size).toBe(100);
    expect(
      repository.cancelMany.mock.calls.every(([ids]) => ids.length === 0),
    ).toBe(true);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('reports a write failure like a gateway failure and keeps earlier pages', async () => {
    const { sync, table, repository } = build(payments(250));
    repository.upsertMany.mockRejectedValueOnce(new Error('db down'));

    const summary = await sync.backfill();

    expect(summary).toMatchObject({ ok: false, pages: 0, failedAtOffset: 0 });
    expect(table.size).toBe(0);
  });

  it('UT-113 running the sync twice over identical gateway data changes no row', async () => {
    const { sync, table } = build(payments(30, { status: 'OVERDUE' }));

    await sync.run();
    const afterFirst = JSON.stringify([...table.entries()]);
    await sync.run();

    expect(JSON.stringify([...table.entries()])).toBe(afterFirst);
    expect(table.size).toBe(30);
  });

  it('runs nightly after the reconciliation and the fee issuer, in Brasília time', () => {
    const options = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      Object.getOwnPropertyDescriptor(PlatformPaymentSync.prototype, 'run')!
        .value as object,
    ) as { cronTime: string; timeZone: string };

    expect(options.cronTime).toBe('15 4 * * *');
    expect(options.timeZone).toBe('America/Sao_Paulo');
  });
});
