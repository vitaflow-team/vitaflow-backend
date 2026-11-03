import { GatewayError } from '../paymentGateway';
import { AsaasGateway, mapChargeStatus } from './asaasGateway';

const BASE = 'https://sandbox.asaas.test/api/v3';
const KEY = 'fake-asaas-valid-key-0001';

function reply(status: number, body: unknown = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
  });
}

function gatewayWith(
  responses: Array<Response | Error>,
  sleeps: number[] = [],
) {
  const fetchImpl = jest.fn();
  for (const response of responses) {
    fetchImpl.mockImplementationOnce(() =>
      response instanceof Error
        ? Promise.reject<Response>(response)
        : Promise.resolve(response),
    );
  }
  const gateway = new AsaasGateway(BASE, {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { gateway, fetchImpl };
}

describe('Asaas client requests (UT-020)', () => {
  it('sends the key in the access_token header to the configured base URL', async () => {
    const { gateway, fetchImpl } = gatewayWith([reply(200, { name: 'Conta' })]);
    await gateway.verifyAccount(KEY);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/myAccount`);
    expect((init.headers as Record<string, string>).access_token).toBe(KEY);
  });

  it('creates the customer with the gateway notifications disabled', async () => {
    const { gateway, fetchImpl } = gatewayWith([reply(200, { id: 'cus_1' })]);
    await gateway.ensureCustomer(KEY, {
      name: 'Diego',
      cpfCnpj: '52998224725',
      email: 'd@x.test',
      externalReference: 'client-1',
    });
    const body = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.notificationDisabled).toBe(true);
  });

  it('registers the webhook with its required events and notification email, per the sandbox (task_01 1.1)', async () => {
    const originalMailUser = process.env.MAIL_USER;
    process.env.MAIL_USER = 'ops@vitaflow.test';
    const { gateway, fetchImpl } = gatewayWith([reply(200, { id: 'wh_1' })]);
    const result = await gateway.registerWebhook(
      KEY,
      'https://api.vitaflow.test/billing/webhooks/asaas',
      'a'.repeat(32),
    );
    const body = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body).toMatchObject({
      url: 'https://api.vitaflow.test/billing/webhooks/asaas',
      email: 'ops@vitaflow.test',
      authToken: 'a'.repeat(32),
      enabled: true,
    });
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThan(0);
    expect(result).toEqual({ webhookId: 'wh_1' });
    process.env.MAIL_USER = originalMailUser;
  });

  it('creates the charge with the payment type undefined, decimal value, due date and external reference', async () => {
    const { gateway, fetchImpl } = gatewayWith([
      reply(200, { id: 'pay_1', invoiceUrl: 'https://pay.test/1' }),
    ]);
    const result = await gateway.createCharge(KEY, {
      customerExternalId: 'cus_1',
      amountCents: 1990,
      dueDate: '2026-10-20',
      description: 'Mensalidade',
      externalReference: 'invoice-1',
    });
    const body = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body).toMatchObject({
      customer: 'cus_1',
      billingType: 'UNDEFINED',
      value: 19.9,
      dueDate: '2026-10-20',
      externalReference: 'invoice-1',
    });
    expect(result).toEqual({
      externalId: 'pay_1',
      paymentUrl: 'https://pay.test/1',
    });
  });
});

describe('Asaas client errors (UT-021)', () => {
  it('maps 401, 400 with a reason, 404, 5xx and a timeout to the typed errors', async () => {
    const cases: Array<[Response | Error, string]> = [
      [reply(401, {}), 'auth'],
      [
        reply(400, { errors: [{ description: 'Valor abaixo do mínimo.' }] }),
        'validation',
      ],
      [reply(404, {}), 'not_found'],
      [reply(500, {}), 'unavailable'],
    ];
    for (const [response, kind] of cases) {
      const { gateway } = gatewayWith([response, response, response]);
      await expect(gateway.verifyAccount(KEY)).rejects.toMatchObject({ kind });
    }

    const { gateway } = gatewayWith([]);
    const never: typeof fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        (init!.signal as AbortSignal).addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      });
    const slow = new AsaasGateway(BASE, {
      fetchImpl: never,
      timeoutMs: 20,
      sleep: () => Promise.resolve(),
    });
    await expect(
      slow.createCharge(KEY, {
        customerExternalId: 'c',
        amountCents: 500,
        dueDate: '2026-10-20',
        description: 'x',
        externalReference: 'i',
      }),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    expect(gateway).toBeDefined();
  });

  it('carries the gateway reason for a validation failure', async () => {
    const { gateway } = gatewayWith([
      reply(400, { errors: [{ description: 'Valor abaixo do mínimo.' }] }),
    ]);
    const error = await gateway
      .verifyAccount(KEY)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).message).toBe('Valor abaixo do mínimo.');
  });
});

describe('Asaas client retries (UT-022)', () => {
  it('retries reads twice on unavailable errors with backoff', async () => {
    const sleeps: number[] = [];
    const { gateway, fetchImpl } = gatewayWith(
      [
        reply(503),
        reply(503),
        reply(200, {
          id: 'pay_1',
          status: 'PENDING',
          value: 5,
          dueDate: '2026-10-20',
          paymentDate: null,
        }),
      ],
      sleeps,
    );
    const charge = await gateway.getCharge(KEY, 'pay_1');
    expect(charge.status).toBe('PENDING');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
  });

  it('never retries creation, update or cancellation', async () => {
    const { gateway, fetchImpl } = gatewayWith([reply(503)]);
    await expect(
      gateway.createCharge(KEY, {
        customerExternalId: 'c',
        amountCents: 500,
        dueDate: '2026-10-20',
        description: 'x',
        externalReference: 'i',
      }),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('Asaas subscription checkout (UT-150)', () => {
  it('creates a checkout with the right billingTypes, chargeTypes, callback, items and subscription body', async () => {
    const { gateway, fetchImpl } = gatewayWith([
      reply(200, { id: 'checkout_1', link: 'https://asaas.test/c/checkout_1' }),
    ]);
    const result = await gateway.createSubscriptionCheckout(KEY, {
      successUrl: 'https://app.test/success',
      cancelUrl: 'https://app.test/cancel',
      itemName: 'Plano Premium',
      valueCents: 2990,
      nextDueDate: '2026-11-20',
      externalReference: 'user-1:product-1',
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(url).toBe(`${BASE}/checkouts`);
    expect(body).toMatchObject({
      billingTypes: ['CREDIT_CARD'],
      chargeTypes: ['RECURRENT'],
      callback: {
        successUrl: 'https://app.test/success',
        cancelUrl: 'https://app.test/cancel',
      },
      items: [{ name: 'Plano Premium', value: 29.9, quantity: 1 }],
      subscription: { cycle: 'MONTHLY', nextDueDate: '2026-11-20' },
      externalReference: 'user-1:product-1',
    });
    expect(result).toEqual({
      checkoutId: 'checkout_1',
      link: 'https://asaas.test/c/checkout_1',
    });
  });

  it('falls back to the canonical checkout URL when the response carries no link', async () => {
    const { gateway } = gatewayWith([reply(200, { id: 'checkout_2' })]);
    const result = await gateway.createSubscriptionCheckout(KEY, {
      successUrl: 'https://app.test/success',
      cancelUrl: 'https://app.test/cancel',
      itemName: 'Plano Premium',
      valueCents: 2990,
      nextDueDate: '2026-11-20',
      externalReference: 'user-1:product-1',
    });
    expect(result.link).toBe(
      'https://asaas.com/checkoutSession/show?id=checkout_2',
    );
  });
});

describe('Asaas subscription update/cancel errors (UT-151)', () => {
  it('maps a 401, a 400 with a reason, a 404 and a 5xx to the same typed errors createCharge uses', async () => {
    const cases: Array<[Response, string]> = [
      [reply(401, {}), 'auth'],
      [
        reply(400, { errors: [{ description: 'Assinatura inválida.' }] }),
        'validation',
      ],
      [reply(404, {}), 'not_found'],
      [reply(500, {}), 'unavailable'],
    ];
    for (const [response, kind] of cases) {
      const { gateway } = gatewayWith([response]);
      await expect(
        gateway.updateSubscription(KEY, 'sub_1', { status: 'INACTIVE' }),
      ).rejects.toMatchObject({ kind });
    }
  });

  it('never retries a subscription update', async () => {
    const { gateway, fetchImpl } = gatewayWith([reply(503)]);
    await expect(
      gateway.updateSubscription(KEY, 'sub_1', { valueCents: 5990 }),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends the decimal value and status to the subscription endpoint', async () => {
    const { gateway, fetchImpl } = gatewayWith([reply(200, {})]);
    await gateway.updateSubscription(KEY, 'sub_1', {
      valueCents: 5990,
      status: 'ACTIVE',
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/subscriptions/sub_1`);
    expect(JSON.parse(init.body as string)).toEqual({
      value: 59.9,
      status: 'ACTIVE',
    });
  });
});

describe('Asaas charge statuses (UT-023)', () => {
  it('maps paid, overdue, pending, deleted and unhandled statuses', () => {
    for (const status of ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']) {
      expect(mapChargeStatus(status)).toBe('PAID');
    }
    expect(mapChargeStatus('OVERDUE')).toBe('OVERDUE');
    expect(mapChargeStatus('PENDING')).toBe('PENDING');
    expect(mapChargeStatus('PENDING', true)).toBe('CANCELED');
    expect(mapChargeStatus('REFUNDED')).toBe('UNHANDLED');
    expect(mapChargeStatus('CHARGEBACK_REQUESTED')).toBe('UNHANDLED');
  });
});
