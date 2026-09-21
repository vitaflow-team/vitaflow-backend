import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { Injectable, Logger } from '@nestjs/common';
import { SyncSubscriptionDTO, UpdateSubscriptionDTO } from './subscription.Dto';
import { deriveExpiry } from './subscriptionExpiry';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private users: UserRepository,
    private products: ProductsRepository,
  ) {}

  async getForUser(userId: string) {
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
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: user.stripeSubscriptionId,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionCancelAt: user.subscriptionCancelAt,
      subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd,
      expiresAt: expiry.expiresAt,
      autoRenew: expiry.autoRenew,
    };
  }

  async updateForUser(userId: string, dto: UpdateSubscriptionDTO) {
    const product = await this.products.getProductById(dto.productId);
    if (!product) {
      throw new AppError('Produto não encontrado.', 404);
    }

    const user = await this.users.updateSubscription(userId, {
      productId: product.id,
      stripeCustomerId: dto.stripeCustomerId,
      stripeSubscriptionId: dto.stripeSubscriptionId,
      subscriptionStatus: dto.subscriptionStatus,
      // Omitted entirely (undefined) means "leave as-is" — a plan change
      // shouldn't silently clear a real pending cancellation the caller
      // didn't ask to touch. Only an explicit value (including null, to
      // reactivate) updates it.
      ...(dto.subscriptionCancelAt !== undefined && {
        subscriptionCancelAt: dto.subscriptionCancelAt
          ? new Date(dto.subscriptionCancelAt)
          : null,
      }),
      // Same three-way rule: Stripe doesn't always carry a period end, and
      // a caller that can't report one must not wipe the date the sidebar
      // renders. Only an explicit null clears it.
      ...(dto.subscriptionCurrentPeriodEnd !== undefined && {
        subscriptionCurrentPeriodEnd: dto.subscriptionCurrentPeriodEnd
          ? new Date(dto.subscriptionCurrentPeriodEnd)
          : null,
      }),
    });

    return this.toResponse(user);
  }

  // Called only by the frontend's Stripe webhook handler (server-to-server,
  // gated by the shared application secret — see ApiKeyGuard). Stripe events
  // are the source of truth for subscription state; a missing user here
  // means the customer hasn't been linked yet or was removed — either way
  // there's nothing to update, so this no-ops rather than erroring, since
  // Stripe retries webhook deliveries that respond with an error status.
  async syncFromWebhook(dto: SyncSubscriptionDTO) {
    let user = await this.users.findByStripeCustomerId(dto.stripeCustomerId);
    if (!user && dto.userId) {
      user = await this.users.findUnique({ id: dto.userId });
    }

    if (!user) {
      this.logger.warn(
        `No user found for Stripe customer ${dto.stripeCustomerId} ` +
          `(userId hint: ${dto.userId ?? 'none'}) — skipping sync.`,
      );
      return null;
    }

    let productId = user.productId;
    if (dto.stripePriceId === null) {
      // The subscription ended, so the user goes back to Gratuito rather
      // than to no plan at all. If the catalog has no free product there is
      // nothing safe to fall back to: keep whatever plan is stored (never
      // null) and let the webhook succeed, since Stripe retries failures.
      const freeProduct = await this.products.findFreeProduct();
      if (freeProduct) {
        productId = freeProduct.id;
        this.logger.log(`subscription_ended_restored_free user=${user.id}`);
      } else {
        this.logger.error(
          'free_product_missing at=webhook_sync — no USER product priced at 0 ' +
            `without a Stripe price id; leaving productId unchanged for user ${user.id}.`,
        );
      }
    } else if (dto.stripePriceId) {
      const product = await this.products.findByStripeId(dto.stripePriceId);
      if (product) {
        productId = product.id;
      } else {
        this.logger.warn(
          `No product matches Stripe price ${dto.stripePriceId} — ` +
            `leaving productId unchanged for user ${user.id}.`,
        );
      }
    }

    const updated = await this.users.updateSubscription(user.id, {
      productId,
      stripeCustomerId: dto.stripeCustomerId,
      stripeSubscriptionId: dto.stripeSubscriptionId,
      subscriptionStatus:
        dto.stripePriceId === null ? 'canceled' : dto.subscriptionStatus,
      subscriptionCancelAt: dto.subscriptionCancelAt
        ? new Date(dto.subscriptionCancelAt)
        : null,
      // Unlike the cancellation date above, an absent period end means the
      // event simply didn't report one (the pinned Stripe API keeps it on
      // the subscription item, which isn't always expanded) — leave the
      // stored value alone rather than clearing it.
      ...(dto.subscriptionCurrentPeriodEnd !== undefined && {
        subscriptionCurrentPeriodEnd: dto.subscriptionCurrentPeriodEnd
          ? new Date(dto.subscriptionCurrentPeriodEnd)
          : null,
      }),
    });

    return this.toResponse(updated);
  }

  private toResponse(
    user: Awaited<ReturnType<UserRepository['updateSubscription']>>,
  ) {
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
