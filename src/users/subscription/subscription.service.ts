import { AcademiaProvisioningService } from '@/academia/academia.service';
import { TemplatesService } from '@/clinical-records/templates/templates.service';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '@/billing/gateway/paymentGateway';
import { NotificationsService } from '@/notifications/notifications.service';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { AppError } from '@/utils/app.erro';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Product, ProductType, Users } from '@prisma/client';
import { AsaasSyncInput } from './asaasSyncInput';
import { CheckoutResponseDTO } from './dto/checkoutResponse.Dto';
import { SubscriptionResponseDTO } from './dto/subscriptionResponse.Dto';
import { SubscriptionStateResponseDTO } from './dto/subscriptionStateResponse.Dto';
import { PLATFORM_ASAAS_API_KEY } from './platformGateway.tokens';
import { prorationDeltaCents } from './proration';
import { deriveExpiry } from './subscriptionExpiry';

// Distinct message per real, detectable billing-event transition (task
// requirement) — see `notifyBillingEvent`'s own comment for why only these
// two are implemented.
const BILLING_EVENT_MESSAGES: Record<string, string> = {
  past_due:
    'Não conseguimos processar o pagamento da sua assinatura. Vamos tentar novamente automaticamente nos próximos dias — atualize seus dados de pagamento para evitar interrupções.',
  unpaid:
    'Sua assinatura está com pagamento pendente após múltiplas tentativas. Atualize seus dados de pagamento para manter seu acesso Premium.',
};

function centsOf(price: number): number {
  return Math.round(price * 100);
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly products: ProductsRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(PLATFORM_ASAAS_API_KEY) private readonly platformApiKey: string,
    private readonly notifications: NotificationsService,
    private readonly academiaProvisioning: AcademiaProvisioningService,
    private readonly templates: TemplatesService,
    private readonly clock: Clock,
  ) {}

  // Starter templates (PRD ADR-004) for every new nutritionist or physical
  // educator — the only way an account becomes one of these types is a
  // product change through this service, so this is "account activation"
  // for the clinical-records engine's purposes. Idempotent: a no-op once the
  // professional already has templates of both purposes.
  private async ensureStarterTemplatesForProfessional(
    userId: string,
    type: ProductType | undefined,
  ): Promise<void> {
    if (
      type !== ProductType.NUTRITIONIST &&
      type !== ProductType.PHYSICAL_EDUCATOR
    ) {
      return;
    }
    await this.templates.ensureStarterTemplates(
      { professionalId: userId },
      type,
    );
  }

  async getForUser(userId: string): Promise<SubscriptionStateResponseDTO> {
    const user = await this.users.findUnique({ id: userId });
    if (!user) {
      throw new AppError('Usuário não encontrado.', 404);
    }

    // No product is loaded on this server-to-server route, so the expiry is
    // derived from the status alone: a Gratuito account cannot hold an
    // active status after the free-plan restore, and the UI reads the
    // profile endpoint, which does check the product.
    const expiry = deriveExpiry({
      status: user.subscriptionStatus,
      cancelAt: user.subscriptionCancelAt,
      periodEnd: user.subscriptionCurrentPeriodEnd,
      planPrice: null,
    });

    return {
      productId: user.productId,
      asaasCustomerId: user.asaasCustomerId,
      asaasSubscriptionId: user.asaasSubscriptionId,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionCancelAt: user.subscriptionCancelAt,
      subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd,
      expiresAt: expiry.expiresAt,
      autoRenew: expiry.autoRenew,
    };
  }

  // Starts an Asaas Checkout for a brand-new subscription (ADR-010 TechSpec
  // addendum, "Checkout flow"). Nothing is written locally yet — Asaas
  // creates the subscription itself on completion, delivered back only via
  // the webhook (`syncFromGateway`), since the hosted checkout page never
  // hands this backend anything to "claim" the way Stripe's client-side
  // session object did.
  async createCheckout(
    userId: string,
    productId: string,
  ): Promise<CheckoutResponseDTO> {
    const user = await this.users.findUnique({ id: userId });
    if (!user) {
      throw new AppError('Usuário não encontrado.', 404);
    }
    const product = await this.products.getProductById(productId);
    if (!product) {
      throw new AppError('Produto não encontrado.', 404);
    }
    if (product.price <= 0) {
      throw new AppError('Este plano não precisa de assinatura.', 400);
    }

    const appUrl = process.env.APP_URL;
    const { link } = await this.gateway.createSubscriptionCheckout(
      this.platformApiKey,
      {
        successUrl: `${appUrl}/restrict/settings?tab=plano&checkout=success`,
        cancelUrl: `${appUrl}/restrict/settings?tab=plano&checkout=canceled`,
        itemName: product.name,
        valueCents: centsOf(product.price),
        nextDueDate: dateOnly(this.clock.now()),
        externalReference: `${userId}:${productId}`,
      },
    );

    return { link };
  }

  // Moves an already-subscribed user to a different paid plan immediately:
  // the subscription's own recurring value changes for future cycles, and
  // the remainder of the current cycle is settled with a one-off adjustment
  // charge (ADR-010 decision 3; see `prorationDeltaCents`).
  async changePlan(
    userId: string,
    newProductId: string,
  ): Promise<SubscriptionResponseDTO> {
    const user = await this.users.findUnique({ id: userId });
    if (!user) {
      throw new AppError('Usuário não encontrado.', 404);
    }
    if (!user.asaasSubscriptionId) {
      throw new AppError('Nenhuma assinatura ativa para alterar.', 400);
    }
    const newProduct = await this.products.getProductById(newProductId);
    if (!newProduct) {
      throw new AppError('Produto não encontrado.', 404);
    }
    if (newProduct.price <= 0) {
      throw new AppError(
        'Para voltar ao plano gratuito, cancele a assinatura.',
        400,
      );
    }

    await this.chargeProrationIfDue(user, newProduct);

    await this.gateway.updateSubscription(
      this.platformApiKey,
      user.asaasSubscriptionId,
      { valueCents: centsOf(newProduct.price) },
    );

    const updated = await this.users.updateSubscription(userId, {
      productId: newProduct.id,
    });

    await this.academiaProvisioning.provisionForOwner(userId);
    await this.ensureStarterTemplatesForProfessional(userId, newProduct.type);

    return this.toResponse(updated);
  }

  // Only an upgrade (a positive delta) is collected as an immediate charge —
  // Asaas's `cobranças` API has no mechanism to issue a negative charge, so
  // a downgrade's credit is left to apply implicitly through the lower
  // recurring value from the next cycle on, same as decision 3's own scope
  // (the subscription's future charges, not a refund mechanism).
  private async chargeProrationIfDue(
    user: Users,
    newProduct: Product,
  ): Promise<void> {
    if (!user.productId || !user.subscriptionCurrentPeriodEnd) {
      return;
    }
    const oldProduct = await this.products.getProductById(user.productId);
    const deltaCents = prorationDeltaCents({
      oldPriceCents: oldProduct ? centsOf(oldProduct.price) : 0,
      newPriceCents: centsOf(newProduct.price),
      now: this.clock.now(),
      periodEnd: user.subscriptionCurrentPeriodEnd,
    });
    if (deltaCents <= 0) {
      return;
    }

    await this.gateway.createCharge(this.platformApiKey, {
      customerExternalId: user.asaasCustomerId ?? '',
      amountCents: deltaCents,
      dueDate: dateOnly(this.clock.now()),
      description: `Ajuste de troca de plano para ${newProduct.name}`,
      externalReference: `${user.id}:${newProduct.id}:proration`,
    });
    this.logger.log(
      `subscription_proration_charged user=${user.id} amountCents=${deltaCents}`,
    );
  }

  // Stops the subscription from generating new charges immediately — Asaas
  // has no "cancel at period end" toggle, so `subscriptionCancelAt` is set
  // locally and `deriveExpiry` keeps the user's access alive until then,
  // same as the Stripe-era behavior (ADR-010 TechSpec addendum, "Cancel and
  // reactivate").
  async cancel(userId: string): Promise<SubscriptionResponseDTO> {
    const user = await this.users.findUnique({ id: userId });
    if (!user) {
      throw new AppError('Usuário não encontrado.', 404);
    }
    if (!user.asaasSubscriptionId) {
      throw new AppError('Nenhuma assinatura ativa para cancelar.', 400);
    }

    await this.gateway.updateSubscription(
      this.platformApiKey,
      user.asaasSubscriptionId,
      { status: 'INACTIVE' },
    );

    const updated = await this.users.updateSubscription(userId, {
      subscriptionCancelAt: user.subscriptionCurrentPeriodEnd,
    });

    return this.toResponse(updated);
  }

  async reactivate(userId: string): Promise<SubscriptionResponseDTO> {
    const user = await this.users.findUnique({ id: userId });
    if (!user) {
      throw new AppError('Usuário não encontrado.', 404);
    }
    if (!user.asaasSubscriptionId) {
      throw new AppError('Nenhuma assinatura para reativar.', 400);
    }

    await this.gateway.updateSubscription(
      this.platformApiKey,
      user.asaasSubscriptionId,
      { status: 'ACTIVE' },
    );

    const updated = await this.users.updateSubscription(userId, {
      subscriptionCancelAt: null,
    });

    return this.toResponse(updated);
  }

  // Called only by the platform's own Asaas webhook (server-to-server,
  // in-process — ADR-010 moves this off the frontend relay the Stripe-era
  // flow needed). Asaas events are the source of truth for subscription
  // state; a missing user here means the customer hasn't been linked yet
  // or was removed — either way there's nothing to update, so this no-ops
  // rather than erroring, since Asaas retries webhook deliveries that
  // respond with an error status.
  async syncFromGateway(
    input: AsaasSyncInput,
  ): Promise<SubscriptionResponseDTO | null> {
    const user = await this.resolveSyncUser(input);

    if (!user) {
      return null;
    }

    const productId = await this.resolveSyncProductId(input, user);

    const updated = await this.users.updateSubscription(user.id, {
      productId,
      asaasCustomerId: input.asaasCustomerId,
      subscriptionStatus: input.subscriptionStatus,
      subscriptionCancelAt: input.subscriptionCancelAt
        ? new Date(input.subscriptionCancelAt)
        : null,
      // CHECKOUT_PAID may arrive before Asaas has created the subscription
      // itself — omitting the key entirely (undefined) leaves the stored
      // id alone instead of wiping it; only an explicit value (including
      // null, when the subscription truly ended) overwrites it.
      ...(input.asaasSubscriptionId !== undefined && {
        asaasSubscriptionId: input.asaasSubscriptionId,
      }),
      // An absent period end means the event simply didn't report one —
      // leave the stored value alone rather than clearing it.
      ...(input.subscriptionCurrentPeriodEnd !== undefined && {
        subscriptionCurrentPeriodEnd: input.subscriptionCurrentPeriodEnd
          ? new Date(input.subscriptionCurrentPeriodEnd)
          : null,
      }),
    });

    // Fire-and-record, after the sync itself has already succeeded: a
    // notification failure must never fail or retry the webhook (Asaas
    // retries on a non-2xx response). `NotificationsService.create` already
    // catches its own email-send errors; nothing here can throw past the
    // sync's own result.
    await this.notifyBillingEvent(
      user.id,
      user.subscriptionStatus,
      input.subscriptionStatus,
    );

    await this.academiaProvisioning.provisionForOwner(user.id);
    await this.ensureStarterTemplatesForProfessional(
      user.id,
      updated.product?.type,
    );

    return this.toResponse(updated);
  }

  // Neither `SUBSCRIPTION_UPDATED` nor `PAYMENT_OVERDUE` carries a distinct
  // "this was a failure" flag by the time it reaches this input — both
  // funnel into the same `subscriptionStatus` field. The only real,
  // detectable billing-event signal available here is the status
  // transition itself: newly entering `past_due` (a charge just failed,
  // Asaas is retrying) or `unpaid` (retries exhausted).
  private async notifyBillingEvent(
    userId: string,
    oldStatus: string | null,
    newStatus: string,
  ): Promise<void> {
    if (oldStatus === newStatus) {
      return;
    }

    const message = BILLING_EVENT_MESSAGES[newStatus];
    if (!message) {
      return;
    }

    await this.notifications.create(
      userId,
      'BILLING',
      message,
      `${process.env.APP_URL}/restrict/settings?tab=plano`,
    );
  }

  private async resolveSyncProductId(
    input: AsaasSyncInput,
    user: Users,
  ): Promise<string | null> {
    if (input.subscriptionStatus === 'canceled') {
      return await this.restoreFreeProductId(user);
    }
    if (input.productId) {
      return input.productId;
    }
    return user.productId;
  }

  // The subscription ended, so the user goes back to Gratuito rather than to
  // no plan at all. If the catalog has no free product there is nothing safe
  // to fall back to: keep whatever plan is stored (never null) and let the
  // webhook succeed, since Asaas retries failures.
  private async restoreFreeProductId(user: Users): Promise<string | null> {
    const freeProduct = await this.products.findFreeProduct();
    if (!freeProduct) {
      this.logger.error(
        'free_product_missing at=webhook_sync — no USER product priced at 0 ' +
          `leaving productId unchanged for user ${user.id}.`,
      );
      return user.productId;
    }
    this.logger.log(`subscription_ended_restored_free user=${user.id}`);
    return freeProduct.id;
  }

  // The customer id is authoritative; the `userId` hint only exists to make
  // the first link after checkout. It may create a link, never replace one:
  // a user already tied to a different customer id is left alone.
  private async resolveSyncUser(input: AsaasSyncInput) {
    const linked = await this.users.findByAsaasCustomerId(
      input.asaasCustomerId,
    );
    if (linked) {
      return linked;
    }

    const candidate = input.userId
      ? await this.users.findUnique({ id: input.userId })
      : null;
    if (!candidate) {
      this.warnNoUser(input);
      return null;
    }

    if (
      candidate.asaasCustomerId &&
      candidate.asaasCustomerId !== input.asaasCustomerId
    ) {
      this.logger.warn(
        `subscription_sync_relink_rejected user=${candidate.id} ` +
          '— already linked to a different Asaas customer.',
      );
      return null;
    }

    return candidate;
  }

  private warnNoUser(input: AsaasSyncInput): void {
    this.logger.warn(
      `No user found for Asaas customer ${input.asaasCustomerId} ` +
        `(userId hint: ${input.userId ?? 'none'}) — skipping sync.`,
    );
  }

  private toResponse(
    user: Awaited<ReturnType<UserRepository['updateSubscription']>>,
  ): SubscriptionResponseDTO {
    const expiry = deriveExpiry({
      status: user.subscriptionStatus,
      cancelAt: user.subscriptionCancelAt,
      periodEnd: user.subscriptionCurrentPeriodEnd,
      planPrice: user.product?.price ?? null,
    });

    return {
      id: user.id,
      productId: user.productId,
      productName: user.product?.name ?? null,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionCancelAt: user.subscriptionCancelAt,
      subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd,
      expiresAt: expiry.expiresAt,
      autoRenew: expiry.autoRenew,
    };
  }
}
