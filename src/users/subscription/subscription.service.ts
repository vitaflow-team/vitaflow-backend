import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { StripeVerification } from '@/utils/stripeVerification';
import { VerifiedSubscription } from '@/utils/verifiedSubscription';
import { Injectable, Logger } from '@nestjs/common';
import { Product, Users } from '@prisma/client';
import { SyncSubscriptionDTO } from './dto/syncSubscription.Dto';
import { SubscriptionResponseDTO } from './dto/subscriptionResponse.Dto';
import { SubscriptionStateResponseDTO } from './dto/subscriptionStateResponse.Dto';
import { UpdateSubscriptionDTO } from './dto/updateSubscription.Dto';
import { deriveExpiry } from './subscriptionExpiry';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly products: ProductsRepository,
    private readonly stripeVerification: StripeVerification,
  ) {}

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
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: user.stripeSubscriptionId,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionCancelAt: user.subscriptionCancelAt,
      subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd,
      expiresAt: expiry.expiresAt,
      autoRenew: expiry.autoRenew,
    };
  }

  async updateForUser(
    userId: string,
    dto: UpdateSubscriptionDTO,
  ): Promise<SubscriptionResponseDTO> {
    const product = await this.products.getProductById(dto.productId);
    if (!product) {
      throw new AppError('Produto não encontrado.', 404);
    }

    const verified = await this.verifyClaim(
      userId,
      dto.stripeSubscriptionId,
      product,
    );

    // Status and customer come from Stripe, never from the caller's body.
    const user = await this.users.updateSubscription(userId, {
      productId: product.id,
      stripeCustomerId: verified.customerId,
      stripeSubscriptionId: dto.stripeSubscriptionId,
      subscriptionStatus: verified.status,
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

  // The caller must name a subscription Stripe knows, created for this user,
  // and billing the very plan being claimed — otherwise any account could
  // declare itself paid, or pay for a cheap plan and claim a dearer one.
  private async verifyClaim(
    userId: string,
    stripeSubscriptionId: string,
    product: Product,
  ): Promise<VerifiedSubscription> {
    const verified = await this.stripeVerification.verifySubscriptionWithStripe(
      stripeSubscriptionId,
      userId,
    );

    if (
      !verified ||
      !verified.belongsToUser ||
      verified.priceId !== product.stripeId
    ) {
      this.logger.warn(`subscription_claim_rejected user=${userId}`);
      throw new AppError('Assinatura inválida.', 400);
    }

    return verified;
  }

  // Called only by the frontend's Stripe webhook handler (server-to-server,
  // gated by the shared application secret — see ApiKeyGuard). Stripe events
  // are the source of truth for subscription state; a missing user here
  // means the customer hasn't been linked yet or was removed — either way
  // there's nothing to update, so this no-ops rather than erroring, since
  // Stripe retries webhook deliveries that respond with an error status.
  async syncFromWebhook(
    dto: SyncSubscriptionDTO,
  ): Promise<SubscriptionResponseDTO | null> {
    const user = await this.resolveSyncUser(dto);

    if (!user) {
      return null;
    }

    const productId = await this.resolveSyncProductId(dto, user);

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

  private async resolveSyncProductId(
    dto: SyncSubscriptionDTO,
    user: Users,
  ): Promise<string | null> {
    if (dto.stripePriceId === null) {
      return await this.restoreFreeProductId(user);
    }
    if (dto.stripePriceId) {
      return await this.findProductIdByPrice(dto.stripePriceId, user);
    }
    return user.productId;
  }

  // The subscription ended, so the user goes back to Gratuito rather than to
  // no plan at all. If the catalog has no free product there is nothing safe
  // to fall back to: keep whatever plan is stored (never null) and let the
  // webhook succeed, since Stripe retries failures.
  private async restoreFreeProductId(user: Users): Promise<string | null> {
    const freeProduct = await this.products.findFreeProduct();
    if (!freeProduct) {
      this.logger.error(
        'free_product_missing at=webhook_sync — no USER product priced at 0 ' +
          `without a Stripe price id; leaving productId unchanged for user ${user.id}.`,
      );
      return user.productId;
    }
    this.logger.log(`subscription_ended_restored_free user=${user.id}`);
    return freeProduct.id;
  }

  private async findProductIdByPrice(
    stripePriceId: string,
    user: Users,
  ): Promise<string | null> {
    const product = await this.products.findByStripeId(stripePriceId);
    if (!product) {
      this.logger.warn(
        `No product matches Stripe price ${stripePriceId} — ` +
          `leaving productId unchanged for user ${user.id}.`,
      );
      return user.productId;
    }
    return product.id;
  }

  // The customer id is authoritative; the `userId` hint only exists to make
  // the first link after checkout. It may create a link, never replace one:
  // a user already tied to a different customer id is left alone.
  private async resolveSyncUser(dto: SyncSubscriptionDTO) {
    const linked = await this.users.findByStripeCustomerId(
      dto.stripeCustomerId,
    );
    if (linked) {
      return linked;
    }

    const candidate = dto.userId
      ? await this.users.findUnique({ id: dto.userId })
      : null;
    if (!candidate) {
      this.warnNoUser(dto);
      return null;
    }

    if (
      candidate.stripeCustomerId &&
      candidate.stripeCustomerId !== dto.stripeCustomerId
    ) {
      this.logger.warn(
        `subscription_sync_relink_rejected user=${candidate.id} ` +
          '— already linked to a different Stripe customer.',
      );
      return null;
    }

    return candidate;
  }

  private warnNoUser(dto: SyncSubscriptionDTO): void {
    this.logger.warn(
      `No user found for Stripe customer ${dto.stripeCustomerId} ` +
        `(userId hint: ${dto.userId ?? 'none'}) — skipping sync.`,
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
