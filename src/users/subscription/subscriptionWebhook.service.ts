import { secretsMatch } from '@/common/guards/apiKey.guard';
import { CodedError } from '@/common/errors/codedError';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AsaasSyncInput } from './asaasSyncInput';
import { PlatformPaymentEvents } from './platformPayments/platformPaymentEvents.service';
import { PLATFORM_WEBHOOK_TOKEN } from './platformGateway.tokens';
import { SubscriptionService } from './subscription.service';

// The payment notices that keep the local payment table current (ADR-006).
const PAYMENT_TABLE_EVENTS = new Set([
  'PAYMENT_CREATED',
  'PAYMENT_UPDATED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE',
  'PAYMENT_DELETED',
  'PAYMENT_REFUNDED',
]);

const GENERIC_UNAUTHORIZED =
  'Não foi possível autenticar a notificação do gateway.';

interface AsaasSubscriptionPayload {
  id?: string;
  customer?: string;
  value?: number;
  status?: string;
  externalReference?: string;
  subscription?: string;
}

interface AsaasWebhookBody {
  event?: string;
  checkout?: AsaasSubscriptionPayload;
  subscription?: AsaasSubscriptionPayload;
  payment?: AsaasSubscriptionPayload;
}

function splitExternalReference(reference: string | undefined): {
  userId?: string;
  productId?: string;
} {
  if (!reference) return {};
  const [userId, productId] = reference.split(':');
  return { userId, productId };
}

// Maps the platform's own Asaas webhook (ADR-010 decision 5 — one
// Vita-Flow-controlled endpoint and token, not ADR-007's per-professional
// pattern) into `SubscriptionService.syncFromGateway`'s input (UT-155).
// Field names below follow the TechSpec addendum's "Webhook event mapping"
// table; the exact Asaas payload shape still needs sandbox confirmation
// (same open item the addendum itself records) before this is trusted as
// final.
@Injectable()
export class SubscriptionWebhookService {
  private readonly logger = new Logger(SubscriptionWebhookService.name);

  constructor(
    @Inject(PLATFORM_WEBHOOK_TOKEN) private readonly webhookToken: string,
    private readonly subscriptions: SubscriptionService,
    // Optional so a module that only exercises the subscription sync can wire
    // this service without the payment table; UsersModule always provides it.
    @Optional() private readonly paymentTable?: PlatformPaymentEvents,
  ) {}

  async handle(tokenHeader: unknown, body: unknown): Promise<void> {
    this.authenticate(tokenHeader);

    const notice = body as AsaasWebhookBody;
    const input = this.toSyncInput(notice);
    if (input) await this.subscriptions.syncFromGateway(input);
    const recorded = await this.recordPayment(notice);

    this.logger.log(
      input || recorded
        ? 'platform_webhook_received accepted=true'
        : 'platform_webhook_received accepted=true reason=unhandled_event',
    );
  }

  // The payment table is fed after the subscription sync, which is left exactly
  // as it was; a failure here answers 503 and the idempotent sync simply runs
  // again when Asaas delivers the notice a second time.
  private async recordPayment(body: AsaasWebhookBody): Promise<boolean> {
    const paymentId = body.payment?.id;
    if (!this.paymentTable || !paymentId) return false;
    if (!body.event || !PAYMENT_TABLE_EVENTS.has(body.event)) return false;
    await this.paymentTable.record(paymentId);
    return true;
  }

  private authenticate(tokenHeader: unknown): void {
    if (!secretsMatch(tokenHeader, this.webhookToken)) {
      throw new CodedError(GENERIC_UNAUTHORIZED, 401, 'webhook_unauthorized');
    }
  }

  private toSyncInput(body: AsaasWebhookBody): AsaasSyncInput | null {
    switch (body.event) {
      case 'CHECKOUT_PAID':
        return this.fromCheckout(body.checkout);
      case 'SUBSCRIPTION_CREATED':
      case 'SUBSCRIPTION_UPDATED':
        return this.fromSubscription(body.subscription, 'active');
      case 'SUBSCRIPTION_DELETED':
        return this.fromSubscriptionDeleted(body.subscription);
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_CONFIRMED':
        return this.fromPayment(body.payment, 'active');
      case 'PAYMENT_OVERDUE':
        return this.fromPayment(body.payment, 'past_due');
      default:
        return null;
    }
  }

  private fromCheckout(
    checkout: AsaasSubscriptionPayload | undefined,
  ): AsaasSyncInput | null {
    if (!checkout?.customer) return null;
    const { userId, productId } = splitExternalReference(
      checkout.externalReference,
    );
    return {
      asaasCustomerId: checkout.customer,
      // Omitted (not null) when absent: Asaas may not have created the
      // subscription yet at CHECKOUT_PAID time — SUBSCRIPTION_CREATED
      // carries the real id shortly after.
      ...(checkout.subscription !== undefined && {
        asaasSubscriptionId: checkout.subscription,
      }),
      userId,
      productId,
      subscriptionStatus: 'active',
    };
  }

  private fromSubscription(
    subscription: AsaasSubscriptionPayload | undefined,
    status: string,
  ): AsaasSyncInput | null {
    if (!subscription?.customer || !subscription.id) return null;
    const { userId, productId } = splitExternalReference(
      subscription.externalReference,
    );
    return {
      asaasCustomerId: subscription.customer,
      asaasSubscriptionId: subscription.id,
      userId,
      productId,
      subscriptionStatus: status,
    };
  }

  private fromSubscriptionDeleted(
    subscription: AsaasSubscriptionPayload | undefined,
  ): AsaasSyncInput | null {
    if (!subscription?.customer) return null;
    return {
      asaasCustomerId: subscription.customer,
      asaasSubscriptionId: null,
      subscriptionStatus: 'canceled',
    };
  }

  private fromPayment(
    payment: AsaasSubscriptionPayload | undefined,
    status: string,
  ): AsaasSyncInput | null {
    if (!payment?.customer || !payment.subscription) return null;
    return {
      asaasCustomerId: payment.customer,
      asaasSubscriptionId: payment.subscription,
      subscriptionStatus: status,
    };
  }
}
