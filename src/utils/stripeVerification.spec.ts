import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { StripeVerification } from './stripeVerification';

const mockRetrieve = jest.fn();

// Only the client constructor is replaced; the real error classes stay, so
// the service's error handling sees exactly what the SDK would throw.
jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const ActualStripe = actual.default ?? actual;
  const MockStripe = Object.assign(
    jest.fn(() => ({
      subscriptions: {
        retrieve: (...args: unknown[]): unknown => mockRetrieve(...args),
      },
    })),
    { errors: ActualStripe.errors },
  );
  return { __esModule: true, default: MockStripe };
});

function stripeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_123',
    status: 'active',
    customer: 'cus_123',
    metadata: { userId: 'user-1' },
    items: { data: [{ price: { id: 'price_premium' } }] },
    ...overrides,
  };
}

describe('StripeVerification.verifySubscriptionWithStripe', () => {
  let verification: StripeVerification;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    mockRetrieve.mockReset();
    verification = new StripeVerification();
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  // UT-005
  it("reports Stripe's own status and ownership when metadata matches", async () => {
    mockRetrieve.mockResolvedValue(stripeSubscription({ status: 'past_due' }));

    const result = await verification.verifySubscriptionWithStripe(
      'sub_123',
      'user-1',
    );

    expect(mockRetrieve).toHaveBeenCalledWith('sub_123');
    expect(result).toEqual({
      status: 'past_due',
      priceId: 'price_premium',
      customerId: 'cus_123',
      belongsToUser: true,
    });
  });

  it('reads the customer id from an expanded customer object', async () => {
    mockRetrieve.mockResolvedValue(
      stripeSubscription({ customer: { id: 'cus_expanded' } }),
    );

    const result = await verification.verifySubscriptionWithStripe(
      'sub_123',
      'user-1',
    );

    expect(result?.customerId).toBe('cus_expanded');
  });

  // UT-006
  it('flags a subscription whose metadata names another user', async () => {
    mockRetrieve.mockResolvedValue(
      stripeSubscription({ metadata: { userId: 'someone-else' } }),
    );

    const result = await verification.verifySubscriptionWithStripe(
      'sub_123',
      'user-1',
    );

    expect(result?.belongsToUser).toBe(false);
  });

  it('flags a subscription with no userId metadata at all', async () => {
    mockRetrieve.mockResolvedValue(stripeSubscription({ metadata: {} }));

    const result = await verification.verifySubscriptionWithStripe(
      'sub_123',
      'user-1',
    );

    expect(result?.belongsToUser).toBe(false);
  });

  // UT-007
  it('returns null when Stripe has no such subscription', async () => {
    mockRetrieve.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error',
        message: 'No such subscription',
        code: 'resource_missing',
      }),
    );

    const result = await verification.verifySubscriptionWithStripe(
      'sub_missing',
      'user-1',
    );

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('reason=resource_missing'),
    );
  });

  // UT-007
  it('returns null when Stripe cannot be reached', async () => {
    mockRetrieve.mockRejectedValue(new Error('socket hang up'));

    const result = await verification.verifySubscriptionWithStripe(
      'sub_123',
      'user-1',
    );

    expect(result).toBeNull();
  });

  it('returns null without calling Stripe for an empty id', async () => {
    const result = await verification.verifySubscriptionWithStripe(
      '',
      'user-1',
    );

    expect(result).toBeNull();
    expect(mockRetrieve).not.toHaveBeenCalled();
  });
});
