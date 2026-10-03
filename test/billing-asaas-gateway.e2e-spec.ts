/**
 * Integration test for PRD `educator-billing`, task 1: the Asaas client against
 * the fake Asaas HTTP server. No database is needed.
 */
import { AsaasGateway } from '@/billing/gateway/asaas/asaasGateway';
import { FAKE_KEYS, FakeAsaasServer } from './support/fakeAsaasServer';

jest.setTimeout(60_000);

describe('Asaas client against the fake gateway (IT-001)', () => {
  const fake = new FakeAsaasServer();
  let gateway: AsaasGateway;

  beforeAll(async () => {
    await fake.start();
    gateway = new AsaasGateway(`${fake.baseUrl}`, { timeoutMs: 400 });
  });

  afterAll(async () => {
    await fake.stop();
  });

  beforeEach(() => {
    fake.requests.length = 0;
  });

  it('verifies, registers the webhook, creates the customer and charge, reads, updates and cancels', async () => {
    const key = FAKE_KEYS.valid;
    expect((await gateway.verifyAccount(key)).accountName).toBe(
      'Conta Teste Sandbox',
    );

    const hook = await gateway.registerWebhook(
      key,
      'https://api.vitaflow.test/billing/webhooks/asaas',
      'token-abc',
    );
    expect(hook.webhookId).toMatch(/^wh_/);
    const hookRequest = fake.requests.find(
      (request) => request.path === '/webhooks',
    );
    expect(hookRequest?.body).toMatchObject({
      authToken: 'token-abc',
      url: 'https://api.vitaflow.test/billing/webhooks/asaas',
    });

    const customer = await gateway.ensureCustomer(key, {
      name: 'Diego Aluno',
      cpfCnpj: '52998224725',
      email: 'diego@example.test',
      externalReference: 'client-1',
    });
    const charge = await gateway.createCharge(key, {
      customerExternalId: customer.externalId,
      amountCents: 1990,
      dueDate: '2026-10-20',
      description: 'Mensalidade',
      externalReference: 'invoice-1',
    });
    expect(charge.paymentUrl).toContain(charge.externalId);

    const read = await gateway.getCharge(key, charge.externalId);
    expect(read).toMatchObject({
      status: 'PENDING',
      valueCents: 1990,
      dueDate: '2026-10-20',
    });

    await gateway.updateCharge(key, charge.externalId, {
      amountCents: 2500,
      dueDate: '2026-10-25',
    });
    expect((await gateway.getCharge(key, charge.externalId)).valueCents).toBe(
      2500,
    );

    await gateway.cancelCharge(key, charge.externalId);
    expect((await gateway.getCharge(key, charge.externalId)).status).toBe(
      'CANCELED',
    );

    expect(
      fake.requests.every((request) => request.headers['access_token'] === key),
    ).toBe(true);
  });

  it('maps a revoked key to an auth error and does not retry it', async () => {
    await expect(
      gateway.verifyAccount(FAKE_KEYS.revoked),
    ).rejects.toMatchObject({ kind: 'auth' });
    expect(
      fake.requests.filter((request) => request.path === '/myAccount'),
    ).toHaveLength(1);
  });

  it('maps a validation reason, a missing record and a gateway failure', async () => {
    const key = FAKE_KEYS.valid;
    const customer = await gateway.ensureCustomer(key, {
      name: 'A',
      cpfCnpj: '52998224725',
      email: 'a@x.test',
      externalReference: 'c',
    });
    await expect(
      gateway.createCharge(key, {
        customerExternalId: customer.externalId,
        amountCents: 100,
        dueDate: '2026-10-20',
        description: 'x',
        externalReference: 'i',
      }),
    ).rejects.toMatchObject({
      kind: 'validation',
      message: 'O valor mínimo de cobrança é R$ 5,00.',
    });

    await expect(gateway.getCharge(key, 'pay_missing')).rejects.toMatchObject({
      kind: 'not_found',
    });
    await expect(gateway.verifyAccount(FAKE_KEYS.down)).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('times out a slow gateway as unavailable', async () => {
    fake.slowMs = 1_500;
    await expect(gateway.verifyAccount(FAKE_KEYS.slow)).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});
