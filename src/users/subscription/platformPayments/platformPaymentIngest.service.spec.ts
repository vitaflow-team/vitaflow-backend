import type { GatewayPaymentItem } from '@/billing/gateway/types/gatewayPaymentItem';
import { PlatformPaymentRepository } from '@/repositories/billing/platformPayment.repository';
import type { PlatformPaymentData } from '@/repositories/billing/types/platformPaymentData';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { Logger } from '@nestjs/common';
import { PlatformPaymentStatus, ProductType } from '@prisma/client';
import { PlatformPaymentIngest } from './platformPaymentIngest.service';

const NOW = new Date('2026-11-17T15:00:00Z');

function item(overrides: Partial<GatewayPaymentItem> = {}): GatewayPaymentItem {
  return {
    id: 'pay_1',
    customer: 'cus_1',
    subscription: 'sub_1',
    valueCents: 14990,
    status: 'RECEIVED',
    dueDate: '2026-11-10',
    paymentDate: '2026-11-11',
    deleted: false,
    ...overrides,
  };
}

// An in-memory payment table: upserting the same Asaas id replaces the row,
// like the real unique key does.
function build(subscribers: Record<string, unknown> = {}) {
  const table = new Map<string, PlatformPaymentData>();
  const users = {
    findSubscribersByCustomerIds: jest.fn((ids: string[]) =>
      Promise.resolve(
        ids.flatMap((id) => (subscribers[id] ? [subscribers[id]] : [])),
      ),
    ),
  };
  const payments = {
    upsertMany: jest.fn((rows: PlatformPaymentData[]) => {
      let created = 0;
      for (const row of rows) {
        if (!table.has(row.asaasPaymentId)) created += 1;
        table.set(row.asaasPaymentId, row);
      }
      return Promise.resolve({ created, updated: rows.length - created });
    }),
    cancelMany: jest.fn((ids: string[]) => {
      let count = 0;
      for (const id of ids) {
        const row = table.get(id);
        if (row && row.status !== PlatformPaymentStatus.CANCELED) {
          table.set(id, { ...row, status: PlatformPaymentStatus.CANCELED });
          count += 1;
        }
      }
      return Promise.resolve(count);
    }),
  };
  const ingest = new PlatformPaymentIngest(
    users as unknown as UserRepository,
    payments as unknown as PlatformPaymentRepository,
    { now: () => NOW } as Clock,
  );
  return { ingest, table, users, payments };
}

const SUBSCRIBER = {
  id: 'user-1',
  asaasCustomerId: 'cus_1',
  product: {
    type: ProductType.PHYSICAL_EDUCATOR,
    name: 'Profissional Premium',
  },
};

describe('PlatformPaymentIngest', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('UT-102 stores a received payment as PAID, in cents, with the dates and the current plan of the user', async () => {
    const { ingest, table } = build({ cus_1: SUBSCRIBER });

    const outcome = await ingest.ingest([item()]);

    expect(outcome).toEqual({ upserted: 1, canceled: 0, skipped: 0 });
    expect(table.get('pay_1')).toEqual({
      asaasPaymentId: 'pay_1',
      userId: 'user-1',
      asaasCustomerId: 'cus_1',
      asaasSubscriptionId: 'sub_1',
      productType: ProductType.PHYSICAL_EDUCATOR,
      productName: 'Profissional Premium',
      valueCents: 14990,
      status: PlatformPaymentStatus.PAID,
      dueDate: '2026-11-10',
      paidAt: '2026-11-11',
      paidAmountCents: 14990,
    });
  });

  it('UT-103 processing the same payment event twice leaves one identical row', async () => {
    const { ingest, table } = build({ cus_1: SUBSCRIBER });

    await ingest.ingest([item()]);
    const first = { ...table.get('pay_1') };
    await ingest.ingest([item()]);

    expect(table.size).toBe(1);
    expect(table.get('pay_1')).toEqual(first);
  });

  it('UT-104 skips a payment whose customer maps to no user and logs it', async () => {
    const { ingest, table } = build({ cus_1: SUBSCRIBER });
    const warn = jest.spyOn(Logger.prototype, 'warn');

    const outcome = await ingest.ingest([
      item({ id: 'pay_x', customer: 'cus_x' }),
    ]);

    expect(outcome).toEqual({ upserted: 0, canceled: 0, skipped: 1 });
    expect(table.size).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('platform_payment_skipped_unknown_customer'),
    );
  });

  it('UT-112 keeps the calendar dates as they are, with no timezone shift', async () => {
    const { ingest, table } = build({ cus_1: SUBSCRIBER });

    await ingest.ingest([
      item({ dueDate: '2026-12-01', paymentDate: '2026-11-30' }),
    ]);

    expect(table.get('pay_1')).toMatchObject({
      dueDate: '2026-12-01',
      paidAt: '2026-11-30',
    });
  });

  it('records a pending payment without a payment date or paid amount', async () => {
    const { ingest, table } = build({ cus_1: SUBSCRIBER });

    await ingest.ingest([item({ status: 'PENDING', paymentDate: null })]);

    expect(table.get('pay_1')).toMatchObject({
      status: PlatformPaymentStatus.PENDING,
      paidAt: null,
      paidAmountCents: null,
    });
  });

  it('dates a paid payment the gateway reports without a payment date on the day it was seen', async () => {
    const { ingest, table } = build({ cus_1: SUBSCRIBER });

    await ingest.ingest([item({ status: 'CONFIRMED', paymentDate: null })]);

    expect(table.get('pay_1')).toMatchObject({
      status: PlatformPaymentStatus.PAID,
      paidAt: '2026-11-17',
    });
  });

  it('skips a payment in a status the panel has no figure for', async () => {
    const { ingest, table } = build({ cus_1: SUBSCRIBER });

    const outcome = await ingest.ingest([
      item({ status: 'CHARGEBACK_DISPUTE' }),
    ]);

    expect(outcome.skipped).toBe(1);
    expect(table.size).toBe(0);
  });

  it('skips a payment of a user with no plan', async () => {
    const { ingest, table } = build({
      cus_1: { ...SUBSCRIBER, product: null },
    });

    const outcome = await ingest.ingest([item()]);

    expect(outcome.skipped).toBe(1);
    expect(table.size).toBe(0);
  });

  it('cancels a removed payment it already holds and never creates a row for one it does not', async () => {
    const { ingest, table } = build({ cus_1: SUBSCRIBER });
    await ingest.ingest([item({ id: 'pay_known', status: 'PENDING' })]);

    const outcome = await ingest.ingest([
      item({ id: 'pay_known', deleted: true }),
      item({ id: 'pay_unknown', deleted: true }),
    ]);

    expect(outcome).toEqual({ upserted: 0, canceled: 1, skipped: 0 });
    expect(table.get('pay_known')?.status).toBe(PlatformPaymentStatus.CANCELED);
    expect(table.has('pay_unknown')).toBe(false);
  });

  it('writes a page in one batch and looks its customers up once', async () => {
    const { ingest, users, payments } = build({ cus_1: SUBSCRIBER });

    await ingest.ingest([
      item({ id: 'a' }),
      item({ id: 'b' }),
      item({ id: 'a', status: 'PENDING', paymentDate: null }),
    ]);

    expect(users.findSubscribersByCustomerIds).toHaveBeenCalledTimes(1);
    expect(users.findSubscribersByCustomerIds).toHaveBeenCalledWith(['cus_1']);
    expect(payments.upsertMany).toHaveBeenCalledTimes(1);
    const rows = payments.upsertMany.mock.calls[0][0];
    expect(rows.map((row) => row.asaasPaymentId)).toEqual(['a', 'b']);
    expect(rows[0].status).toBe(PlatformPaymentStatus.PENDING);
  });
});
