import { centsToDecimal } from '@/billing/shared/money';
import {
  ChargeInput,
  CustomerInput,
  GatewayCharge,
  GatewayChargeStatus,
  GatewayError,
  PaymentGateway,
} from '../paymentGateway';

const REQUEST_TIMEOUT_MS = 10_000;
const READ_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 300;

// Asaas rejects a webhook with no `events` ("É necessário informar no
// mínimo um evento de notificação para essa configuração" — confirmed in
// the sandbox, task_01 subtask 1.1). This set matches what mapChargeStatus
// below already interprets — PAID (RECEIVED, CONFIRMED), OVERDUE, and a
// charge being removed. `RECEIVED_IN_CASH` is a status value, not its own
// webhook event name ("PAYMENT_RECEIVED_IN_CASH" was rejected as invalid
// in the sandbox) — a manually-marked-paid charge surfaces through
// PAYMENT_RECEIVED/PAYMENT_CONFIRMED with that status on the payload.
const WEBHOOK_EVENTS = [
  'PAYMENT_CREATED',
  'PAYMENT_RECEIVED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_OVERDUE',
  'PAYMENT_DELETED',
] as const;

interface AsaasRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  retryable: boolean;
}

interface AsaasOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function mapChargeStatus(
  rawStatus: string,
  deleted = false,
): GatewayChargeStatus {
  if (deleted) return 'CANCELED';
  if (['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(rawStatus))
    return 'PAID';
  if (rawStatus === 'OVERDUE') return 'OVERDUE';
  if (rawStatus === 'PENDING') return 'PENDING';
  return 'UNHANDLED';
}

function validationReason(body: unknown): string {
  const errors = (body as { errors?: Array<{ description?: string }> } | null)
    ?.errors;
  const reason = errors?.[0]?.description;
  return reason ?? 'O Asaas recusou os dados enviados.';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Talks to the Asaas REST API with the professional's key in the access_token
// header. Reads are retried; mutations are never retried automatically.
export class AsaasGateway implements PaymentGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly baseUrl: string,
    options: AsaasOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.sleep = options.sleep ?? delay;
  }

  async verifyAccount(apiKey: string): Promise<{ accountName: string }> {
    const body = await this.call<{ name: string }>(apiKey, {
      method: 'GET',
      path: '/myAccount',
      retryable: true,
    });
    return { accountName: body.name };
  }

  // `email` is Asaas's own delivery-failure alert address, not a parameter
  // of this call — it's always Vita Flow's own ops inbox regardless of
  // which professional's account registers the webhook, and Asaas rejects
  // the request without one ("O parâmetro email deve ser informado" —
  // confirmed in the sandbox, task_01 subtask 1.1).
  async registerWebhook(
    apiKey: string,
    url: string,
    token: string,
  ): Promise<{ webhookId: string }> {
    const body = await this.call<{ id: string }>(apiKey, {
      method: 'POST',
      path: '/webhooks',
      body: {
        name: 'Vita Flow',
        url,
        email: process.env.MAIL_USER,
        enabled: true,
        interrupted: false,
        authToken: token,
        sendType: 'SEQUENTIALLY',
        events: WEBHOOK_EVENTS,
      },
      retryable: false,
    });
    return { webhookId: body.id };
  }

  async removeWebhook(apiKey: string, webhookId: string): Promise<void> {
    await this.call(apiKey, {
      method: 'DELETE',
      path: `/webhooks/${webhookId}`,
      retryable: false,
    });
  }

  async ensureCustomer(
    apiKey: string,
    customer: CustomerInput,
  ): Promise<{ externalId: string }> {
    const body = await this.call<{ id: string }>(apiKey, {
      method: 'POST',
      path: '/customers',
      body: {
        name: customer.name,
        cpfCnpj: customer.cpfCnpj,
        email: customer.email,
        externalReference: customer.externalReference,
        notificationDisabled: true,
      },
      retryable: false,
    });
    return { externalId: body.id };
  }

  async createCharge(
    apiKey: string,
    charge: ChargeInput,
  ): Promise<{ externalId: string; paymentUrl: string }> {
    const body = await this.call<{ id: string; invoiceUrl: string }>(apiKey, {
      method: 'POST',
      path: '/payments',
      body: {
        customer: charge.customerExternalId,
        // Asaas rejects a charge with no billingType ("O parâmetro
        // billingType deve ser informado" — confirmed in the sandbox,
        // task_01 subtask 1.1). UNDEFINED lets the payer pick Pix, boleto
        // or card on the link itself — matching ADR-001 decision 5 ("the
        // payer's choice of payment method is not restricted by the
        // professional").
        billingType: 'UNDEFINED',
        value: centsToDecimal(charge.amountCents),
        dueDate: charge.dueDate,
        description: charge.description,
        externalReference: charge.externalReference,
      },
      retryable: false,
    });
    return { externalId: body.id, paymentUrl: body.invoiceUrl };
  }

  async getCharge(apiKey: string, externalId: string): Promise<GatewayCharge> {
    const body = await this.call<{
      id: string;
      status: string;
      value: number;
      dueDate: string;
      paymentDate: string | null;
      deleted?: boolean;
    }>(apiKey, {
      method: 'GET',
      path: `/payments/${externalId}`,
      retryable: true,
    });
    return {
      externalId: body.id,
      status: mapChargeStatus(body.status, body.deleted === true),
      rawStatus: body.status,
      valueCents: Math.round(body.value * 100),
      dueDate: body.dueDate,
      paymentDate: body.paymentDate,
    };
  }

  async updateCharge(
    apiKey: string,
    externalId: string,
    changes: { amountCents?: number; dueDate?: string },
  ): Promise<void> {
    await this.call(apiKey, {
      method: 'PUT',
      path: `/payments/${externalId}`,
      body: {
        ...(changes.amountCents === undefined
          ? {}
          : { value: centsToDecimal(changes.amountCents) }),
        ...(changes.dueDate === undefined ? {} : { dueDate: changes.dueDate }),
      },
      retryable: false,
    });
  }

  async cancelCharge(apiKey: string, externalId: string): Promise<void> {
    await this.call(apiKey, {
      method: 'DELETE',
      path: `/payments/${externalId}`,
      retryable: false,
    });
  }

  private async call<T = unknown>(
    apiKey: string,
    request: AsaasRequest,
  ): Promise<T> {
    const attempts = request.retryable ? READ_RETRIES + 1 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.send<T>(apiKey, request);
      } catch (error) {
        const retryable =
          error instanceof GatewayError && error.kind === 'unavailable';
        if (!retryable || attempt === attempts - 1) throw error;
        await this.sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
    throw new GatewayError(
      'unavailable',
      'O Asaas está indisponível no momento.',
    );
  }

  private async send<T>(apiKey: string, request: AsaasRequest): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${request.path}`, {
        method: request.method,
        headers: { access_token: apiKey, 'content-type': 'application/json' },
        body:
          request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });
    } catch {
      throw new GatewayError(
        'unavailable',
        'O Asaas está indisponível no momento.',
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401)
      throw new GatewayError('auth', 'A chave de API foi recusada.');
    if (response.status === 404)
      throw new GatewayError('not_found', 'Registro não encontrado no Asaas.');
    if (response.status >= 500)
      throw new GatewayError(
        'unavailable',
        'O Asaas está indisponível no momento.',
      );

    const text = await response.text();
    const body = text.length > 0 ? JSON.parse(text) : undefined;
    if (response.status >= 400) {
      throw new GatewayError('validation', validationReason(body));
    }
    return body as T;
  }
}
