import { AcademiaProvisioningService } from '@/academia/academia.service';
import { TemplatesService } from '@/clinical-records/templates/templates.service';
import { PAYMENT_GATEWAY } from '@/billing/gateway/paymentGateway';
import { NotificationsService } from '@/notifications/notifications.service';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { AppError } from '@/utils/app.erro';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PLATFORM_ASAAS_API_KEY } from './platformGateway.tokens';
import { SubscriptionService } from './subscription.service';

const PLATFORM_KEY = 'platform-asaas-key';
const PERIOD_END = new Date('2026-11-30T00:00:00.000Z');
const NOW = new Date('2026-11-20T00:00:00.000Z'); // 10 days remaining of 30

const storedUser = {
  id: 'user-1',
  productId: 'product-1',
  asaasCustomerId: 'cus_123',
  asaasSubscriptionId: 'sub_123',
  subscriptionStatus: 'active',
  subscriptionCancelAt: null,
  subscriptionCurrentPeriodEnd: PERIOD_END,
  product: { id: 'product-1', name: 'Plano Premium', price: 29.9 },
};

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let users: {
    findUnique: jest.Mock;
    findByAsaasCustomerId: jest.Mock;
    updateSubscription: jest.Mock;
  };
  let products: {
    getProductById: jest.Mock;
    findFreeProduct: jest.Mock;
  };
  let gateway: {
    createSubscriptionCheckout: jest.Mock;
    updateSubscription: jest.Mock;
    createCharge: jest.Mock;
  };
  let notifications: { create: jest.Mock };
  let academiaProvisioning: { provisionForOwner: jest.Mock };
  let templates: { ensureStarterTemplates: jest.Mock };
  let clock: { now: jest.Mock };

  /** The `data` object the service handed to `updateSubscription`. */
  const updateData = () =>
    users.updateSubscription.mock.calls[0][1] as Record<string, unknown>;

  beforeEach(async () => {
    users = {
      findUnique: jest.fn().mockResolvedValue(storedUser),
      findByAsaasCustomerId: jest.fn().mockResolvedValue(storedUser),
      updateSubscription: jest.fn().mockResolvedValue(storedUser),
    };
    products = {
      getProductById: jest.fn().mockResolvedValue({
        id: 'product-1',
        name: 'Plano Premium',
        price: 29.9,
        type: 'USER',
      }),
      findFreeProduct: jest.fn().mockResolvedValue({ id: 'free-1', price: 0 }),
    };
    gateway = {
      createSubscriptionCheckout: jest.fn().mockResolvedValue({
        checkoutId: 'checkout_1',
        link: 'https://asaas.test/c/1',
      }),
      updateSubscription: jest.fn().mockResolvedValue(undefined),
      createCharge: jest.fn().mockResolvedValue({
        externalId: 'pay_1',
        paymentUrl: 'https://pay.test/1',
      }),
    };
    notifications = { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) };
    academiaProvisioning = {
      provisionForOwner: jest.fn().mockResolvedValue(null),
    };
    templates = {
      ensureStarterTemplates: jest.fn().mockResolvedValue(undefined),
    };
    clock = { now: jest.fn().mockReturnValue(NOW) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: UserRepository, useValue: users },
        { provide: ProductsRepository, useValue: products },
        { provide: PAYMENT_GATEWAY, useValue: gateway },
        { provide: PLATFORM_ASAAS_API_KEY, useValue: PLATFORM_KEY },
        { provide: NotificationsService, useValue: notifications },
        {
          provide: AcademiaProvisioningService,
          useValue: academiaProvisioning,
        },
        { provide: TemplatesService, useValue: templates },
        { provide: Clock, useValue: clock },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
  });

  describe('getForUser', () => {
    it('derives the expiry from the status alone (no product loaded here)', async () => {
      const result = await service.getForUser('user-1');

      expect(result.expiresAt).toEqual(PERIOD_END);
      expect(result.autoRenew).toBe(true);
      expect(result.asaasSubscriptionId).toBe('sub_123');
    });

    it('rejects when the user no longer exists', async () => {
      users.findUnique.mockResolvedValueOnce(null);
      await expect(service.getForUser('missing')).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('createCheckout (UT-150 integration point)', () => {
    it('starts an Asaas Checkout with the product name, value and encoded externalReference', async () => {
      const result = await service.createCheckout('user-1', 'product-1');

      expect(gateway.createSubscriptionCheckout).toHaveBeenCalledWith(
        PLATFORM_KEY,
        expect.objectContaining({
          itemName: 'Plano Premium',
          valueCents: 2990,
          externalReference: 'user-1:product-1',
        }),
      );
      expect(result).toEqual({ link: 'https://asaas.test/c/1' });
      // Nothing is written locally yet — only the webhook confirms it.
      expect(users.updateSubscription).not.toHaveBeenCalled();
    });

    it('rejects a free product — nothing to subscribe to', async () => {
      products.getProductById.mockResolvedValueOnce({
        id: 'free-1',
        name: 'Gratuito',
        price: 0,
      });

      await expect(
        service.createCheckout('user-1', 'free-1'),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects an unknown product', async () => {
      products.getProductById.mockResolvedValueOnce(null);

      await expect(
        service.createCheckout('user-1', 'missing'),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('changePlan', () => {
    it('rejects a user with no active subscription, pointing to checkout instead', async () => {
      users.findUnique.mockResolvedValueOnce({
        ...storedUser,
        asaasSubscriptionId: null,
      });

      await expect(
        service.changePlan('user-1', 'product-2'),
      ).rejects.toBeInstanceOf(AppError);
    });

    it('rejects moving to the free plan — must cancel instead', async () => {
      products.getProductById.mockResolvedValueOnce({
        id: 'free-1',
        name: 'Gratuito',
        price: 0,
      });

      await expect(
        service.changePlan('user-1', 'free-1'),
      ).rejects.toMatchObject({ status: 400 });
    });

    // UT-153 — upgrade issues a one-off adjustment charge at the moment of
    // the change, and updates the subscription's recurring value.
    it('issues a proration charge and updates the subscription value for an upgrade', async () => {
      products.getProductById
        .mockResolvedValueOnce({
          id: 'product-2',
          name: 'Plano Profissional',
          price: 59.9,
          type: 'USER',
        })
        .mockResolvedValueOnce({ id: 'product-1', price: 29.9 });

      await service.changePlan('user-1', 'product-2');

      // (5990 - 2990) * (10/30) = 1000
      expect(gateway.createCharge).toHaveBeenCalledWith(
        PLATFORM_KEY,
        expect.objectContaining({ amountCents: 1000 }),
      );
      expect(gateway.updateSubscription).toHaveBeenCalledWith(
        PLATFORM_KEY,
        'sub_123',
        { valueCents: 5990 },
      );
      expect(updateData()).toMatchObject({ productId: 'product-2' });
    });

    // UT-152/153 — a downgrade's negative delta is never charged.
    it('skips the adjustment charge for a downgrade', async () => {
      products.getProductById
        .mockResolvedValueOnce({
          id: 'product-cheap',
          name: 'Plano Básico',
          price: 19.9,
          type: 'USER',
        })
        .mockResolvedValueOnce({ id: 'product-1', price: 29.9 });

      await service.changePlan('user-1', 'product-cheap');

      expect(gateway.createCharge).not.toHaveBeenCalled();
      expect(gateway.updateSubscription).toHaveBeenCalledWith(
        PLATFORM_KEY,
        'sub_123',
        { valueCents: 1990 },
      );
    });

    it('seeds starter templates when the new product is NUTRITIONIST or PHYSICAL_EDUCATOR', async () => {
      products.getProductById
        .mockResolvedValueOnce({
          id: 'product-nutri',
          name: 'Nutricionista Premium',
          price: 59.9,
          type: 'NUTRITIONIST',
        })
        .mockResolvedValueOnce({ id: 'product-1', price: 29.9 });

      await service.changePlan('user-1', 'product-nutri');

      expect(templates.ensureStarterTemplates).toHaveBeenCalledWith(
        { professionalId: 'user-1' },
        'NUTRITIONIST',
      );
    });
  });

  describe('cancel', () => {
    it('sets the subscription INACTIVE on the gateway and schedules the local cancellation at the period end', async () => {
      await service.cancel('user-1');

      expect(gateway.updateSubscription).toHaveBeenCalledWith(
        PLATFORM_KEY,
        'sub_123',
        { status: 'INACTIVE' },
      );
      expect(updateData()).toEqual({ subscriptionCancelAt: PERIOD_END });
    });

    it('rejects a user with no active subscription', async () => {
      users.findUnique.mockResolvedValueOnce({
        ...storedUser,
        asaasSubscriptionId: null,
      });

      await expect(service.cancel('user-1')).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('reactivate', () => {
    it('sets the subscription ACTIVE again and clears the local cancellation', async () => {
      await service.reactivate('user-1');

      expect(gateway.updateSubscription).toHaveBeenCalledWith(
        PLATFORM_KEY,
        'sub_123',
        { status: 'ACTIVE' },
      );
      expect(updateData()).toEqual({ subscriptionCancelAt: null });
    });
  });

  describe('syncFromGateway', () => {
    const baseInput = {
      asaasCustomerId: 'cus_123',
      asaasSubscriptionId: 'sub_123',
      subscriptionStatus: 'active',
    };

    it('syncs the subscription fields from the event', async () => {
      await service.syncFromGateway({ ...baseInput });

      expect(updateData()).toMatchObject({
        asaasCustomerId: 'cus_123',
        asaasSubscriptionId: 'sub_123',
        subscriptionStatus: 'active',
      });
    });

    // UT-155 — SUBSCRIPTION_DELETED restores the free plan and marks the
    // subscription canceled, same business rule the Stripe-era webhook had.
    it('restores the free product and marks the subscription canceled when the subscription ends', async () => {
      await service.syncFromGateway({
        asaasCustomerId: 'cus_123',
        asaasSubscriptionId: null,
        subscriptionStatus: 'canceled',
      });

      expect(updateData()).toMatchObject({
        productId: 'free-1',
        subscriptionStatus: 'canceled',
      });
    });

    it('uses the productId hint on first link (from externalReference)', async () => {
      users.findByAsaasCustomerId.mockResolvedValueOnce(null);
      users.findUnique.mockResolvedValueOnce({
        ...storedUser,
        asaasCustomerId: null,
      });

      await service.syncFromGateway({
        ...baseInput,
        asaasCustomerId: 'cus_new',
        userId: 'user-1',
        productId: 'product-2',
      });

      expect(updateData()).toMatchObject({ productId: 'product-2' });
    });

    it('refuses to relink a user already tied to a different Asaas customer', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      users.findByAsaasCustomerId.mockResolvedValueOnce(null);
      users.findUnique.mockResolvedValueOnce({
        ...storedUser,
        asaasCustomerId: 'cus_existing',
      });

      const result = await service.syncFromGateway({
        ...baseInput,
        asaasCustomerId: 'cus_new',
        userId: 'user-1',
      });

      expect(result).toBeNull();
      expect(users.updateSubscription).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('is a no-op, not an error, when neither the customer nor the hinted user exists', async () => {
      users.findByAsaasCustomerId.mockResolvedValueOnce(null);
      users.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.syncFromGateway({
          ...baseInput,
          asaasCustomerId: 'cus_unknown',
        }),
      ).resolves.toBeNull();
      expect(users.updateSubscription).not.toHaveBeenCalled();
    });

    describe('billing notification on status transition', () => {
      it('creates a BILLING notification when the status transitions to past_due', async () => {
        await service.syncFromGateway({
          ...baseInput,
          subscriptionStatus: 'past_due',
        });

        expect(notifications.create).toHaveBeenCalledWith(
          'user-1',
          'BILLING',
          expect.stringContaining('pagamento'),
          expect.any(String),
        );
      });

      it('does not notify when the status does not actually change', async () => {
        await service.syncFromGateway({
          ...baseInput,
          subscriptionStatus: 'active',
        });

        expect(notifications.create).not.toHaveBeenCalled();
      });
    });
  });
});
