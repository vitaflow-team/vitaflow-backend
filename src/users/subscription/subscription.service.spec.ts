import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { StripeVerification } from '@/utils/stripeVerification';
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
  let stripeVerification: { verifySubscriptionWithStripe: jest.Mock };

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
      getProductById: jest.fn().mockResolvedValue({
        id: 'product-1',
        name: 'Plano Premium',
        stripeId: 'price_premium',
      }),
      findByStripeId: jest
        .fn()
        .mockResolvedValue({ id: 'product-1', name: 'Plano Premium' }),
      findFreeProduct: jest.fn().mockResolvedValue({ id: 'free-1' }),
    };
    stripeVerification = {
      verifySubscriptionWithStripe: jest.fn().mockResolvedValue({
        status: 'active',
        priceId: 'price_premium',
        customerId: 'cus_123',
        belongsToUser: true,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: UserRepository, useValue: users },
        { provide: ProductsRepository, useValue: products },
        { provide: StripeVerification, useValue: stripeVerification },
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

  describe('updateForUser — Stripe verification', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      warn.mockRestore();
    });

    // UT-005
    it("persists Stripe's status and customer, never the caller's", async () => {
      stripeVerification.verifySubscriptionWithStripe.mockResolvedValue({
        status: 'incomplete',
        priceId: 'price_premium',
        customerId: 'cus_from_stripe',
        belongsToUser: true,
      });

      await service.updateForUser('user-1', {
        productId: 'product-1',
        stripeCustomerId: 'cus_forged',
        stripeSubscriptionId: 'sub_123',
        subscriptionStatus: 'active',
      });

      expect(
        stripeVerification.verifySubscriptionWithStripe,
      ).toHaveBeenCalledWith('sub_123', 'user-1');
      expect(updateData()).toMatchObject({
        productId: 'product-1',
        stripeSubscriptionId: 'sub_123',
        stripeCustomerId: 'cus_from_stripe',
        subscriptionStatus: 'incomplete',
      });
    });

    // UT-006
    it('rejects with 400 and writes nothing when the subscription belongs to another user', async () => {
      stripeVerification.verifySubscriptionWithStripe.mockResolvedValue({
        status: 'active',
        priceId: 'price_premium',
        customerId: 'cus_other',
        belongsToUser: false,
      });

      const attempt = service.updateForUser('user-1', {
        productId: 'product-1',
        stripeCustomerId: 'cus_other',
        stripeSubscriptionId: 'sub_someone_else',
        subscriptionStatus: 'active',
      });

      await expect(attempt).rejects.toBeInstanceOf(AppError);
      await expect(attempt).rejects.toMatchObject({ status: 400 });
      expect(users.updateSubscription).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        'subscription_claim_rejected user=user-1',
      );
    });

    // UT-007
    it('rejects with 400 and writes nothing when Stripe cannot confirm the subscription', async () => {
      stripeVerification.verifySubscriptionWithStripe.mockResolvedValue(null);

      await expect(
        service.updateForUser('user-1', {
          productId: 'product-1',
          stripeCustomerId: 'cus_123',
          stripeSubscriptionId: 'sub_forged',
          subscriptionStatus: 'active',
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(users.updateSubscription).not.toHaveBeenCalled();
    });

    it('rejects a real subscription used to claim a different paid plan', async () => {
      products.getProductById.mockResolvedValue({
        id: 'product-expensive',
        name: 'Plano Profissional',
        stripeId: 'price_expensive',
      });

      await expect(
        service.updateForUser('user-1', {
          productId: 'product-expensive',
          stripeCustomerId: 'cus_123',
          stripeSubscriptionId: 'sub_123',
          subscriptionStatus: 'active',
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(users.updateSubscription).not.toHaveBeenCalled();
    });

    it('rejects an unknown product before asking Stripe', async () => {
      products.getProductById.mockResolvedValue(null);

      await expect(
        service.updateForUser('user-1', {
          productId: 'missing',
          stripeCustomerId: 'cus_123',
          stripeSubscriptionId: 'sub_123',
          subscriptionStatus: 'active',
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        stripeVerification.verifySubscriptionWithStripe,
      ).not.toHaveBeenCalled();
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

  describe('syncFromWebhook — relink guard (UT-008, ADR-003)', () => {
    const newCustomerDto = {
      stripeCustomerId: 'cus_new',
      stripePriceId: 'price_123',
      stripeSubscriptionId: 'sub_new',
      subscriptionStatus: 'active',
      userId: 'user-1',
    };

    beforeEach(() => {
      // No user owns the incoming customer id yet, so the userId hint is used.
      users.findByStripeCustomerId.mockResolvedValue(null);
    });

    it('refuses to relink a user who already has a different customer id', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      users.findUnique.mockResolvedValue({
        ...storedUser,
        stripeCustomerId: 'cus_existing',
      });

      const result = await service.syncFromWebhook(newCustomerDto);

      expect(result).toBeNull();
      expect(users.findUnique).toHaveBeenCalledWith({ id: 'user-1' });
      expect(users.updateSubscription).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'subscription_sync_relink_rejected user=user-1',
        ),
      );
      // Ids only: neither customer id is written to the log.
      expect(String(warn.mock.calls[0][0])).not.toContain('cus_');
      warn.mockRestore();
    });

    it('links a brand-new customer id to a user with none yet', async () => {
      users.findUnique.mockResolvedValue({
        ...storedUser,
        stripeCustomerId: null,
      });

      await service.syncFromWebhook(newCustomerDto);

      expect(users.updateSubscription).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ stripeCustomerId: 'cus_new' }),
      );
    });

    it('treats a hint for a user already holding this same customer id as a normal sync', async () => {
      users.findUnique.mockResolvedValue({
        ...storedUser,
        stripeCustomerId: 'cus_new',
      });

      await service.syncFromWebhook(newCustomerDto);

      expect(users.updateSubscription).toHaveBeenCalledTimes(1);
    });

    it('is a no-op, not an error, for a retried delivery of an already-linked pair (EC-1)', async () => {
      users.findByStripeCustomerId.mockResolvedValue(storedUser);

      await expect(
        service.syncFromWebhook({
          ...newCustomerDto,
          stripeCustomerId: 'cus_123',
        }),
      ).resolves.not.toBeNull();
      await service.syncFromWebhook({
        ...newCustomerDto,
        stripeCustomerId: 'cus_123',
      });

      expect(users.findUnique).not.toHaveBeenCalled();
      expect(users.updateSubscription.mock.calls[0]).toEqual(
        users.updateSubscription.mock.calls[1],
      );
    });

    it('still skips quietly when neither the customer nor the hinted user exists', async () => {
      users.findUnique.mockResolvedValue(null);

      await expect(service.syncFromWebhook(newCustomerDto)).resolves.toBeNull();
      await expect(
        service.syncFromWebhook({ ...newCustomerDto, userId: undefined }),
      ).resolves.toBeNull();
      expect(users.updateSubscription).not.toHaveBeenCalled();
    });
  });
});
