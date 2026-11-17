import { GatewayError } from '@/billing/gateway/paymentGateway';
import type { PaymentGateway } from '@/billing/gateway/paymentGateway';
import type { GatewayPaymentItem } from '@/billing/gateway/types/gatewayPaymentItem';
import { PlatformPaymentRepository } from '@/repositories/billing/platformPayment.repository';
import type { PlatformPaymentData } from '@/repositories/billing/types/platformPaymentData';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { Logger } from '@nestjs/common';
import { PlatformPaymentStatus, ProductType } from '@prisma/client';
import { PlatformPaymentEvents } from './platformPayments/platformPaymentEvents.service';
import { PlatformPaymentIngest } from './platformPayments/platformPaymentIngest.service';
import { SubscriptionService } from './subscription.service';
import { SubscriptionWebhookService } from './subscriptionWebhook.service';

const TOKEN = 'platform-webhook-token-0001';
const KEY = 'platform-key';

function paymentItem(
  overrides: Partial<GatewayPaymentItem> = {},
): GatewayPaymentItem {
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

function build(getPaymentItem: jest.Mock, wired = true) {
  const table = new Map<string, PlatformPaymentData>();
  const payments = {
    upsertMany: jest.fn((rows: PlatformPaymentData[]) => {
      rows.forEach((row) => table.set(row.asaasPaymentId, row));
      return Promise.resolve({ created: rows.length, updated: 0 });
    }),
    cancelMany: jest.fn((ids: string[]) => {
      let count = 0;
      for (const id of ids) {
        const row = table.get(id);
        if (row) {
          table.set(id, { ...row, status: PlatformPaymentStatus.CANCELED });
          count += 1;
        }
      }
      return Promise.resolve(count);
    }),
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
  const ingest = new PlatformPaymentIngest(
    users as unknown as UserRepository,
    payments as unknown as PlatformPaymentRepository,
    { now: () => new Date('2026-11-17T15:00:00Z') } as Clock,
  );
  const events = new PlatformPaymentEvents(
    { getPaymentItem } as unknown as PaymentGateway,
    KEY,
    ingest,
    payments as unknown as PlatformPaymentRepository,
  );
  const sync = jest.fn().mockResolvedValue(null);
  const service = new SubscriptionWebhookService(
    TOKEN,
    { syncFromGateway: sync } as unknown as SubscriptionService,
    wired ? events : undefined,
  );
  return { service, table, payments, sync, getPaymentItem };
}

function notice(event: string, id = 'pay_1', status = 'RECEIVED') {
  return {
    event,
    payment: { id, customer: 'cus_1', subscription: 'sub_1', status },
  };
}

describe('Platform webhook: payment events feed the payment table', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    'PAYMENT_CREATED',
    'PAYMENT_UPDATED',
    'PAYMENT_CONFIRMED',
    'PAYMENT_RECEIVED',
    'PAYMENT_OVERDUE',
    'PAYMENT_DELETED',
    'PAYMENT_REFUNDED',
  ])(
    '%s re-reads the payment with the platform key and writes the row',
    async (event) => {
      const { service, table, getPaymentItem } = build(
        jest.fn().mockResolvedValue(paymentItem()),
      );

      await service.handle(TOKEN, notice(event));

      expect(getPaymentItem).toHaveBeenCalledWith(KEY, 'pay_1');
      expect(table.get('pay_1')?.status).toBe(PlatformPaymentStatus.PAID);
    },
  );

  it('UT-106 follows the gateway when the notice and the re-read disagree', async () => {
    const { service, table } = build(
      jest.fn().mockResolvedValue(paymentItem({ status: 'OVERDUE' })),
    );

    await service.handle(
      TOKEN,
      notice('PAYMENT_RECEIVED', 'pay_1', 'RECEIVED'),
    );

    expect(table.get('pay_1')?.status).toBe(PlatformPaymentStatus.OVERDUE);
  });

  it.each(['unavailable', 'auth', 'validation'] as const)(
    'UT-107 answers 503 and writes nothing when the re-read fails (%s)',
    async (kind) => {
      const { service, table, payments } = build(
        jest.fn().mockRejectedValue(new GatewayError(kind, 'falhou')),
      );

      await expect(
        service.handle(TOKEN, notice('PAYMENT_RECEIVED')),
      ).rejects.toMatchObject({
        status: 503,
        response: expect.objectContaining({
          code: 'platform_payment_reread_failed',
        }) as unknown,
      });

      expect(table.size).toBe(0);
      expect(payments.upsertMany).not.toHaveBeenCalled();
    },
  );

  it('UT-108 turns a removed payment it holds into CANCELED', async () => {
    const getPaymentItem = jest
      .fn()
      .mockResolvedValueOnce(paymentItem({ status: 'PENDING' }))
      .mockResolvedValueOnce(paymentItem({ status: 'PENDING', deleted: true }));
    const { service, table } = build(getPaymentItem);
    await service.handle(TOKEN, notice('PAYMENT_CREATED'));

    await service.handle(TOKEN, notice('PAYMENT_DELETED'));

    expect(table.get('pay_1')?.status).toBe(PlatformPaymentStatus.CANCELED);
  });

  it('UT-108 answers 200 and writes no row for a removed payment it never held', async () => {
    const getPaymentItem = jest
      .fn()
      .mockRejectedValue(new GatewayError('not_found', 'sumiu'));
    const { service, table } = build(getPaymentItem);

    await expect(
      service.handle(TOKEN, notice('PAYMENT_DELETED', 'pay_unknown')),
    ).resolves.toBeUndefined();

    expect(table.size).toBe(0);
  });

  it('keeps the subscription sync exactly as it was, ahead of the payment table', async () => {
    const order: string[] = [];
    const getPaymentItem = jest.fn().mockImplementation(() => {
      order.push('reread');
      return Promise.resolve(paymentItem());
    });
    const { service, sync } = build(getPaymentItem);
    sync.mockImplementation(() => {
      order.push('sync');
      return Promise.resolve(null);
    });

    await service.handle(TOKEN, notice('PAYMENT_RECEIVED'));

    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({
        asaasCustomerId: 'cus_1',
        asaasSubscriptionId: 'sub_1',
        subscriptionStatus: 'active',
      }),
    );
    expect(order).toEqual(['sync', 'reread']);
  });

  it('does not touch the payment table for other events or a notice without a payment id', async () => {
    const { service, getPaymentItem } = build(jest.fn());

    await service.handle(TOKEN, { event: 'SUBSCRIPTION_CREATED' });
    await service.handle(TOKEN, { event: 'PAYMENT_RECEIVED', payment: {} });
    await service.handle(TOKEN, {
      event: 'PAYMENT_AUTHORIZED',
      payment: { id: 'pay_1' },
    });

    expect(getPaymentItem).not.toHaveBeenCalled();
  });

  it('rejects a wrong token before reading anything', async () => {
    const { service, getPaymentItem } = build(jest.fn());

    await expect(
      service.handle('wrong', notice('PAYMENT_RECEIVED')),
    ).rejects.toMatchObject({ status: 401 });

    expect(getPaymentItem).not.toHaveBeenCalled();
  });

  it('still syncs the subscription when no payment table is wired', async () => {
    const { service, sync } = build(jest.fn(), false);

    await service.handle(TOKEN, notice('PAYMENT_OVERDUE'));

    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: 'past_due' }),
    );
  });
});
