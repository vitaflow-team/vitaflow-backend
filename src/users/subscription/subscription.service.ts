import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { Injectable, Logger } from '@nestjs/common';
import { SyncSubscriptionDTO, UpdateSubscriptionDTO } from './subscription.Dto';

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

    return {
      productId: user.productId,
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: user.stripeSubscriptionId,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionCancelAt: user.subscriptionCancelAt,
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
      productId = null;
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
      subscriptionStatus: dto.subscriptionStatus,
      subscriptionCancelAt: dto.subscriptionCancelAt
        ? new Date(dto.subscriptionCancelAt)
        : null,
    });

    return this.toResponse(updated);
  }

  private toResponse(
    user: Awaited<ReturnType<UserRepository['updateSubscription']>>,
  ) {
    return {
      id: user.id,
      productId: user.productId,
      productName: user.product?.name ?? null,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionCancelAt: user.subscriptionCancelAt,
    };
  }
}
