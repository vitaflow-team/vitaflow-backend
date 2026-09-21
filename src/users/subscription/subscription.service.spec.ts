import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService } from './subscription.service';

const PERIOD_END_ISO = '2026-10-18T15:00:00.000Z';

const storedUser = {
  id: 'user-1',
  productId: 'product-1',
  stripeCustomerId: 'cus_123',
  stripeSubscriptionId: 'sub_123',
  subscriptionStatus: 'active',
  subscriptionCancelAt: null,
  subscriptionCurrentPeriodEnd: new Date('2026-09-18T15:00:00.000Z'),
  product: { id: 'product-1', name: 'Plano Premium' },
};

describe('SubscriptionService — subscriptionCurrentPeriodEnd semantics', () => {
  let service: SubscriptionService;
  let users: {
    findUnique: jest.Mock;
    findByStripeCustomerId: jest.Mock;
    updateSubscription: jest.Mock;
  };
  let products: {
    getProductById: jest.Mock;
    findByStripeId: jest.Mock;
    findFreeProduct: jest.Mock;
  };

  /** The `data` object the service handed to `updateSubscription`. */
  const updateData = () =>
    users.updateSubscription.mock.calls[0][1] as Record<string, unknown>;

  beforeEach(async () => {
    users = {
      findUnique: jest.fn().mockResolvedValue(storedUser),
      findByStripeCustomerId: jest.fn().mockResolvedValue(storedUser),
      updateSubscription: jest.fn().mockResolvedValue(storedUser),
    };
    products = {
      getProductById: jest
        .fn()
        .mockResolvedValue({ id: 'product-1', name: 'Plano Premium' }),
      findByStripeId: jest
        .fn()
        .mockResolvedValue({ id: 'product-1', name: 'Plano Premium' }),
      findFreeProduct: jest.fn().mockResolvedValue({ id: 'free-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: UserRepository, useValue: users },
        { provide: ProductsRepository, useValue: products },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
  });

  describe('updateForUser', () => {
    const baseDto = {
      productId: 'product-1',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      subscriptionStatus: 'active',
    };

    // UT-048
    it('omits the key entirely when the field is not sent', async () => {
      await service.updateForUser('user-1', { ...baseDto });

      expect(updateData()).not.toHaveProperty('subscriptionCurrentPeriodEnd');
    });

    // UT-049
    it('stores a Date when an ISO timestamp is sent', async () => {
      await service.updateForUser('user-1', {
        ...baseDto,
        subscriptionCurrentPeriodEnd: PERIOD_END_ISO,
      });

      expect(updateData().subscriptionCurrentPeriodEnd).toEqual(
        new Date(PERIOD_END_ISO),
      );
    });

    // UT-049
    it('stores null when an explicit null is sent', async () => {
      await service.updateForUser('user-1', {
        ...baseDto,
        subscriptionCurrentPeriodEnd: null,
      });

      expect(updateData()).toHaveProperty('subscriptionCurrentPeriodEnd', null);
    });

    it('returns the period end on the response', async () => {
      const result = await service.updateForUser('user-1', { ...baseDto });

      expect(result.subscriptionCurrentPeriodEnd).toEqual(
        storedUser.subscriptionCurrentPeriodEnd,
      );
    });
  });

  // UT-017 — plan expiry on the subscription responses
  describe('expiresAt and autoRenew (plan expiry)', () => {
    const periodEnd = new Date('2026-10-18T15:00:00.000Z');
    const cancelAt = new Date('2026-10-10T15:00:00.000Z');

    it('toResponse derives a renewing expiry from the stored plan price', async () => {
      users.updateSubscription.mockResolvedValueOnce({
        ...storedUser,
        subscriptionCurrentPeriodEnd: periodEnd,
        product: { id: 'product-1', name: 'Plano Premium', price: 29.9 },
      });

      const result = await service.updateForUser('user-1', {
        productId: 'product-1',
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
        subscriptionStatus: 'active',
      });

      expect(result.expiresAt).toEqual(periodEnd);
      expect(result.autoRenew).toBe(true);
    });

    it('toResponse reports the cancellation date with autoRenew false', async () => {
      users.updateSubscription.mockResolvedValueOnce({
        ...storedUser,
        subscriptionCancelAt: cancelAt,
        subscriptionCurrentPeriodEnd: periodEnd,
        product: { id: 'product-1', name: 'Plano Premium', price: 29.9 },
      });

      const result = await service.updateForUser('user-1', {
        productId: 'product-1',
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
        subscriptionStatus: 'active',
      });

      expect(result.expiresAt).toEqual(cancelAt);
      expect(result.autoRenew).toBe(false);
    });

    it('toResponse reports no expiry for Gratuito', async () => {
      users.updateSubscription.mockResolvedValueOnce({
        ...storedUser,
        subscriptionCurrentPeriodEnd: periodEnd,
        product: { id: 'free-1', name: 'Gratuito', price: 0 },
      });

      const result = await service.updateForUser('user-1', {
        productId: 'free-1',
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
        subscriptionStatus: 'active',
      });

      expect(result.expiresAt).toBeNull();
      expect(result.autoRenew).toBe(false);
    });

    // No product is loaded on this route, so the rule is status-only.
    it('getForUser derives the expiry from the status alone', async () => {
      users.findUnique.mockResolvedValueOnce({
        ...storedUser,
        subscriptionCurrentPeriodEnd: periodEnd,
      });

      const renewing = await service.getForUser('user-1');

      expect(renewing.expiresAt).toEqual(periodEnd);
      expect(renewing.autoRenew).toBe(true);
      // Existing fields are untouched.
      expect(renewing.stripeSubscriptionId).toBe('sub_123');

      users.findUnique.mockResolvedValueOnce({
        ...storedUser,
        subscriptionStatus: 'canceled',
        subscriptionCurrentPeriodEnd: periodEnd,
      });

      const canceled = await service.getForUser('user-1');

      expect(canceled.expiresAt).toBeNull();
      expect(canceled.autoRenew).toBe(false);
    });
  });

  describe('syncFromWebhook', () => {
    const baseDto = {
      stripeCustomerId: 'cus_123',
      stripePriceId: 'price_123',
      stripeSubscriptionId: 'sub_123',
      subscriptionStatus: 'active',
    };

    // UT-050
    it('omits the key entirely when the event does not carry the field', async () => {
      await service.syncFromWebhook({ ...baseDto });

      expect(updateData()).not.toHaveProperty('subscriptionCurrentPeriodEnd');
    });

    // UT-050
    it('stores a Date when an ISO timestamp is sent', async () => {
      await service.syncFromWebhook({
        ...baseDto,
        subscriptionCurrentPeriodEnd: PERIOD_END_ISO,
      });

      expect(updateData().subscriptionCurrentPeriodEnd).toEqual(
        new Date(PERIOD_END_ISO),
      );
    });

    // UT-050
    it('stores null when an explicit null is sent (subscription deleted)', async () => {
      await service.syncFromWebhook({
        ...baseDto,
        subscriptionStatus: 'canceled',
        subscriptionCurrentPeriodEnd: null,
      });

      expect(updateData()).toHaveProperty('subscriptionCurrentPeriodEnd', null);
    });

    // UT-050 — a redelivered event must converge on the same stored state.
    it('produces identical repository arguments when called twice with the same payload', async () => {
      const dto = {
        ...baseDto,
        subscriptionCurrentPeriodEnd: PERIOD_END_ISO,
      };

      await service.syncFromWebhook({ ...dto });
      await service.syncFromWebhook({ ...dto });

      expect(users.updateSubscription).toHaveBeenCalledTimes(2);
      expect(users.updateSubscription.mock.calls[0]).toEqual(
        users.updateSubscription.mock.calls[1],
      );
    });

    // Guards the pre-existing behavior this task must not change: the
    // cancellation date is still overwritten with null when absent.
    it('still clears subscriptionCancelAt when the event omits it', async () => {
      await service.syncFromWebhook({ ...baseDto });

      expect(updateData()).toHaveProperty('subscriptionCancelAt', null);
    });
  });

  describe('syncFromWebhook — free plan restore', () => {
    const endedDto = {
      stripeCustomerId: 'cus_123',
      stripePriceId: null,
      stripeSubscriptionId: 'sub_123',
      subscriptionStatus: 'incomplete_expired',
    };

    // UT-007
    it('restores the free product and marks the subscription canceled', async () => {
      await service.syncFromWebhook({ ...endedDto });

      expect(updateData()).toMatchObject({
        productId: 'free-1',
        subscriptionStatus: 'canceled',
      });
    });

    // UT-007
    it('logs the restore with the user id only', async () => {
      const logged = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);

      await service.syncFromWebhook({ ...endedDto });

      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining(storedUser.id),
      );
      logged.mockRestore();
    });

    // UT-008
    it('leaves the stored product untouched and does not throw when the free product is missing', async () => {
      products.findFreeProduct.mockResolvedValue(null);
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(
        service.syncFromWebhook({ ...endedDto }),
      ).resolves.toBeTruthy();

      expect(updateData().productId).toBe(storedUser.productId);
      expect(updateData().productId).not.toBeNull();
      expect(logged).toHaveBeenCalled();
      logged.mockRestore();
    });

    // UT-009
    it('still maps a known price id to its product', async () => {
      await service.syncFromWebhook({
        ...endedDto,
        stripePriceId: 'price_123',
        subscriptionStatus: 'active',
      });

      expect(updateData()).toMatchObject({
        productId: 'product-1',
        subscriptionStatus: 'active',
      });
      expect(products.findFreeProduct).not.toHaveBeenCalled();
    });

    // UT-009
    it('still keeps the current product for an unknown price id', async () => {
      products.findByStripeId.mockResolvedValue(null);

      await service.syncFromWebhook({
        ...endedDto,
        stripePriceId: 'price_unknown',
        subscriptionStatus: 'active',
      });

      expect(updateData().productId).toBe(storedUser.productId);
      expect(products.findFreeProduct).not.toHaveBeenCalled();
    });
  });
});
