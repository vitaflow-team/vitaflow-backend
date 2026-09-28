import { StripeVerification } from '@/utils/stripeVerification';
import { VerifiedSubscription } from '@/utils/verifiedSubscription';

// Subscriptions "known to Stripe" in unit tests, keyed by subscription id.
// `ownerId` is what Stripe holds in `metadata.userId`.
export const stripeSubscriptionsMock: Record<
  string,
  Omit<VerifiedSubscription, 'belongsToUser'> & { ownerId: string }
> = {
  sub_123: {
    status: 'active',
    priceId: 'st_123',
    customerId: 'cus_123',
    ownerId: '1',
  },
};

export const stripeVerificationMock = {
  provide: StripeVerification,
  useValue: {
    verifySubscriptionWithStripe: jest
      .fn()
      .mockImplementation(
        (
          stripeSubscriptionId: string,
          userId: string,
        ): Promise<VerifiedSubscription | null> => {
          const known = stripeSubscriptionsMock[stripeSubscriptionId];
          if (!known) {
            return Promise.resolve(null);
          }
          const { ownerId, ...subscription } = known;
          return Promise.resolve({
            ...subscription,
            belongsToUser: ownerId === userId,
          });
        },
      ),
  },
};
