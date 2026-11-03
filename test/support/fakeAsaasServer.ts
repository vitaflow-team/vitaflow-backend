import { AddressInfo } from 'net';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';

// Keys that make the fake gateway behave like each failure the client must map.
export const FAKE_KEYS = {
  valid: 'fake-asaas-valid-key-0001',
  revoked: 'fake-asaas-revoked-key-0002',
  down: 'fake-asaas-down-key-0003',
  slow: 'fake-asaas-slow-key-0004',
} as const;

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown> | undefined;
}

interface StoredCharge {
  id: string;
  value: number;
  dueDate: string;
  status: string;
  paymentDate: string | null;
  deleted: boolean;
}

interface StoredSubscription {
  id: string;
  value: number;
  status: string;
}

export class FakeAsaasServer {
  readonly requests: RecordedRequest[] = [];
  readonly charges = new Map<string, StoredCharge>();
  readonly subscriptions = new Map<string, StoredSubscription>();
  private server: Server | null = null;
  private counter = 0;
  slowMs = 1_500;

  get baseUrl(): string {
    const address = this.server?.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(0, '127.0.0.1', resolve),
    );
  }

  async stop(): Promise<void> {
    await new Promise<void>(
      (resolve) => this.server?.close(() => resolve()) ?? resolve(),
    );
  }

  setChargeStatus(
    id: string,
    status: string,
    paymentDate: string | null = null,
  ): void {
    const charge = this.charges.get(id);
    if (charge) Object.assign(charge, { status, paymentDate });
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body =
      raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
    const path = request.url ?? '/';
    const key = request.headers['access_token'];
    this.requests.push({
      method: request.method ?? 'GET',
      path,
      headers: request.headers,
      body,
    });

    if (key === FAKE_KEYS.slow)
      await new Promise((resolve) => setTimeout(resolve, this.slowMs));
    if (key === FAKE_KEYS.revoked)
      return this.send(response, 401, {
        errors: [{ description: 'Chave inválida.' }],
      });
    if (key === FAKE_KEYS.down) return this.send(response, 500, { errors: [] });

    return this.route(request.method ?? 'GET', path, body, response);
  }

  private route(
    method: string,
    path: string,
    body: Record<string, unknown> | undefined,
    response: ServerResponse,
  ): void {
    if (method === 'GET' && path === '/myAccount')
      return this.send(response, 200, { name: 'Conta Teste Sandbox' });
    if (method === 'POST' && path === '/webhooks')
      return this.send(response, 200, { id: this.nextId('wh') });
    if (method === 'DELETE' && path.startsWith('/webhooks/'))
      return this.send(response, 200, { deleted: true });
    if (method === 'POST' && path === '/customers')
      return this.send(response, 200, { id: this.nextId('cus') });
    if (method === 'POST' && path === '/payments')
      return this.createCharge(body ?? {}, response);
    if (path.startsWith('/payments/'))
      return this.chargeRoute(
        method,
        path.slice('/payments/'.length),
        body,
        response,
      );
    if (method === 'POST' && path === '/checkouts')
      return this.createCheckout(body ?? {}, response);
    if (path.startsWith('/subscriptions/'))
      return this.subscriptionRoute(
        method,
        path.slice('/subscriptions/'.length),
        body,
        response,
      );
    return this.send(response, 404, {
      errors: [{ description: 'Rota não encontrada.' }],
    });
  }

  // Mirrors the checkout's `items[0].value` and `subscription.cycle` onto a
  // stored subscription straight away, same as Asaas creating the real
  // subscription on checkout completion — tests drive the webhook
  // separately (IT-030), this only needs to exist for `updateSubscription`
  // (IT-031) to have something to act on.
  private createCheckout(
    body: Record<string, unknown>,
    response: ServerResponse,
  ): void {
    const items = body.items as Array<{ value: number }> | undefined;
    const id = this.nextId('checkout');
    const subscriptionId = this.nextId('sub');
    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      value: items?.[0]?.value ?? 0,
      status: 'ACTIVE',
    });
    return this.send(response, 200, {
      id,
      link: `https://sandbox.asaas.test/checkoutSession/show?id=${id}`,
      subscription: subscriptionId,
    });
  }

  private subscriptionRoute(
    method: string,
    id: string,
    body: Record<string, unknown> | undefined,
    response: ServerResponse,
  ): void {
    const subscription = this.subscriptions.get(id);
    if (!subscription)
      return this.send(response, 404, {
        errors: [{ description: 'Assinatura não encontrada.' }],
      });
    if (method === 'PUT') {
      if (body?.value !== undefined) subscription.value = Number(body.value);
      if (typeof body?.status === 'string') subscription.status = body.status;
      return this.send(response, 200, subscription);
    }
    return this.send(response, 405, {});
  }

  private createCharge(
    body: Record<string, unknown>,
    response: ServerResponse,
  ): void {
    const value = Number(body.value);
    if (value < 5) {
      return this.send(response, 400, {
        errors: [{ description: 'O valor mínimo de cobrança é R$ 5,00.' }],
      });
    }
    const id = this.nextId('pay');
    this.charges.set(id, {
      id,
      value,
      dueDate: String(body.dueDate),
      status: 'PENDING',
      paymentDate: null,
      deleted: false,
    });
    return this.send(response, 200, {
      id,
      invoiceUrl: `https://sandbox.asaas.test/i/${id}`,
    });
  }

  private chargeRoute(
    method: string,
    id: string,
    body: Record<string, unknown> | undefined,
    response: ServerResponse,
  ): void {
    const charge = this.charges.get(id);
    if (!charge)
      return this.send(response, 404, {
        errors: [{ description: 'Cobrança não encontrada.' }],
      });
    if (method === 'GET') return this.send(response, 200, charge);
    if (method === 'PUT') {
      if (body?.value !== undefined) charge.value = Number(body.value);
      if (typeof body?.dueDate === 'string') charge.dueDate = body.dueDate;
      return this.send(response, 200, charge);
    }
    if (method === 'DELETE') {
      charge.deleted = true;
      charge.status = 'PENDING';
      return this.send(response, 200, { deleted: true, id });
    }
    return this.send(response, 405, {});
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter}`;
  }

  private send(
    response: ServerResponse,
    status: number,
    payload: unknown,
  ): void {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  }
}
