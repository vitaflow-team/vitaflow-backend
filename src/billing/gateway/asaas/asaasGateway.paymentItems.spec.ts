import { GatewayError } from '../paymentGateway';
import { AsaasGateway } from './asaasGateway';

const BASE = 'https://sandbox.asaas.test/api/v3';
const KEY = 'fake-platform-key-0001';

function reply(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status });
}

function gatewayWith(responses: Response[]) {
  const fetchImpl = jest.fn();
  for (const response of responses) {
    fetchImpl.mockImplementationOnce(() => Promise.resolve(response));
  }
  const gateway = new AsaasGateway(BASE, {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: () => Promise.resolve(),
  });
  return { gateway, fetchImpl };
}

const PAYMENT = {
  id: 'pay_1',
  customer: 'cus_1',
  subscription: 'sub_1',
  value: 149.9,
  status: 'RECEIVED',
  dueDate: '2026-11-10',
  paymentDate: '2026-11-11',
  deleted: false,
};

describe('AsaasGateway.listPaymentItems', () => {
  it('maps a page to items and asks for the due-date window, 100 at a time', async () => {
    const { gateway, fetchImpl } = gatewayWith([
      reply(200, { data: [PAYMENT], hasMore: false }),
    ]);

    const items = await gateway.listPaymentItems(KEY, {
      dueFrom: '2026-09-18',
      dueTo: '2026-12-17',
      offset: 200,
    });

    expect(items).toEqual([
      {
        id: 'pay_1',
        customer: 'cus_1',
        subscription: 'sub_1',
        valueCents: 14990,
        status: 'RECEIVED',
        dueDate: '2026-11-10',
        paymentDate: '2026-11-11',
        deleted: false,
      },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const query = new URL(url).searchParams;
    expect(query.get('dueDate[ge]')).toBe('2026-09-18');
    expect(query.get('dueDate[le]')).toBe('2026-12-17');
    expect(query.get('limit')).toBe('100');
    expect(query.get('offset')).toBe('200');
    expect((init.headers as Record<string, string>).access_token).toBe(KEY);
  });

  it('lists the whole history when no due-date bound is given', async () => {
    const { gateway, fetchImpl } = gatewayWith([reply(200, { data: [] })]);

    await gateway.listPaymentItems(KEY, { offset: 0 });

    const url = (fetchImpl.mock.calls[0] as [string])[0];
    expect(url).not.toContain('dueDate');
    expect(new URL(url).searchParams.get('limit')).toBe('100');
  });

  it('reads a payment without a subscription or payment date as nulls', async () => {
    const { gateway } = gatewayWith([
      reply(200, {
        data: [{ ...PAYMENT, subscription: undefined, paymentDate: undefined }],
      }),
    ]);

    const [item] = await gateway.listPaymentItems(KEY, { offset: 0 });

    expect(item.subscription).toBeNull();
    expect(item.paymentDate).toBeNull();
  });

  it('throws GatewayError(unavailable) when the gateway keeps failing', async () => {
    const { gateway } = gatewayWith([reply(500), reply(500), reply(500)]);

    await expect(
      gateway.listPaymentItems(KEY, { offset: 0 }),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

describe('AsaasGateway.getPaymentItem', () => {
  it('re-reads one payment with its customer, subscription and removal flag', async () => {
    const { gateway, fetchImpl } = gatewayWith([
      reply(200, { ...PAYMENT, status: 'OVERDUE', deleted: true }),
    ]);

    const item = await gateway.getPaymentItem(KEY, 'pay_1');

    expect(item).toMatchObject({
      id: 'pay_1',
      customer: 'cus_1',
      subscription: 'sub_1',
      status: 'OVERDUE',
      deleted: true,
    });
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe(
      `${BASE}/payments/pay_1`,
    );
  });

  it('throws GatewayError(not_found) for an unknown payment', async () => {
    const { gateway } = gatewayWith([reply(404)]);

    const failure = gateway.getPaymentItem(KEY, 'missing');

    await expect(failure).rejects.toBeInstanceOf(GatewayError);
    await expect(failure).rejects.toMatchObject({ kind: 'not_found' });
  });
});
