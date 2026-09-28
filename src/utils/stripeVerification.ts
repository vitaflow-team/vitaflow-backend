import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { VerifiedSubscription } from './verifiedSubscription';

// Read-only view of Stripe used to check a subscription claim before the
// backend trusts it. Nothing here ever writes to Stripe.
@Injectable()
export class StripeVerification {
  private readonly logger = new Logger(StripeVerification.name);
  private client: Stripe | null = null;

  async verifySubscriptionWithStripe(
    stripeSubscriptionId: string,
    userId: string,
  ): Promise<VerifiedSubscription | null> {
    if (!stripeSubscriptionId) {
      return null;
    }

    let subscription: Stripe.Subscription;
    try {
      subscription =
        await this.getClient().subscriptions.retrieve(stripeSubscriptionId);
    } catch (error) {
      // Unknown subscription, bad key, or Stripe unreachable: all of them
      // mean the claim cannot be confirmed, never that it can be trusted.
      this.logger.warn(
        `subscription_verification_failed user=${userId} reason=${this.errorCode(error)}`,
      );
      return null;
    }

    return {
      status: subscription.status,
      priceId: subscription.items.data[0]?.price.id ?? null,
      customerId:
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id,
      belongsToUser: subscription.metadata?.userId === userId,
    };
  }

  private getClient(): Stripe {
    this.client ??= new Stripe(process.env.STRIPE_API_KEY ?? '');
    return this.client;
  }

  private errorCode(error: unknown): string {
    if (error instanceof Stripe.errors.StripeError) {
      return error.code ?? error.type;
    }
    return 'unknown';
  }
}
