import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { ExecutionContext } from '@nestjs/common';
import { Product, Users } from '@prisma/client';
import { isPremiumUser, PremiumGuard } from './premium.guard';

function makeUser(overrides: Partial<Users> = {}): Users {
  const timestamp = new Date('2026-09-30T09:00:00.000Z');
  return {
    id: 'user-1',
    name: 'Usuária',
    email: 'user@example.com',
    password: 'hash',
    avatar: null,
    active: true,
    phone: null,
    birthDate: null,
    productId: null,
    termsAcceptedAt: null,
    healthDataConsentAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    subscriptionCancelAt: null,
    subscriptionCurrentPeriodEnd: null,
    isBackoffice: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    name: 'Premium',
    price: 49,
    groupId: 'group-1',
    type: 'USER',
    stripeId: null,
    createdAt: new Date('2026-09-30T09:00:00.000Z'),
    updatedAt: new Date('2026-09-30T09:00:00.000Z'),
    ...overrides,
  };
}

function contextFor(userId: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: userId } }),
    }),
  } as ExecutionContext;
}

describe('isPremiumUser', () => {
  it('requires an active/trialing/past_due status and a non-zero price', () => {
    expect(
      isPremiumUser({ subscriptionStatus: 'active', productPrice: 49 }),
    ).toBe(true);
    expect(
      isPremiumUser({ subscriptionStatus: 'past_due', productPrice: 49 }),
    ).toBe(true);
    expect(isPremiumUser({ subscriptionStatus: null, productPrice: 49 })).toBe(
      false,
    );
    expect(
      isPremiumUser({ subscriptionStatus: 'active', productPrice: 0 }),
    ).toBe(false);
    expect(
      isPremiumUser({ subscriptionStatus: 'active', productPrice: null }),
    ).toBe(false);
    expect(
      isPremiumUser({ subscriptionStatus: 'canceled', productPrice: 49 }),
    ).toBe(false);
  });
});

describe('PremiumGuard', () => {
  const findByIdWithProduct = jest.fn();
  const guard = new PremiumGuard({
    findByIdWithProduct,
  } as unknown as UserRepository);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('denies a Free-tier request with AppError(402)', async () => {
    findByIdWithProduct.mockResolvedValue({
      ...makeUser({ subscriptionStatus: 'active' }),
      product: makeProduct({ price: 0 }),
    });

    await expect(guard.canActivate(contextFor('user-1'))).rejects.toThrow(
      AppError,
    );

    findByIdWithProduct.mockResolvedValue({
      ...makeUser({ subscriptionStatus: 'active' }),
      product: makeProduct({ price: 0 }),
    });
    try {
      await guard.canActivate(contextFor('user-1'));
    } catch (error) {
      expect((error as AppError).getStatus()).toBe(402);
      expect((error as AppError).message).toBe(
        'Este recurso requer o plano Premium.',
      );
    }
  });

  it('allows an active Premium request', async () => {
    findByIdWithProduct.mockResolvedValue({
      ...makeUser({ subscriptionStatus: 'active' }),
      product: makeProduct({ price: 49 }),
    });

    await expect(guard.canActivate(contextFor('user-1'))).resolves.toBe(true);
  });

  it('denies when the user cannot be found', async () => {
    findByIdWithProduct.mockResolvedValue(null);

    await expect(guard.canActivate(contextFor('user-1'))).rejects.toThrow(
      AppError,
    );
  });

  describe('isPremium', () => {
    it('reads from an already-loaded user without a second query', () => {
      const user = {
        ...makeUser({ subscriptionStatus: 'trialing' }),
        product: makeProduct({ price: 49 }),
      };

      expect(guard.isPremium(user)).toBe(true);
      expect(findByIdWithProduct).not.toHaveBeenCalled();
    });

    it('is false for a Free-tier or missing-product user', () => {
      expect(
        guard.isPremium({
          ...makeUser({ subscriptionStatus: 'active' }),
          product: null,
        }),
      ).toBe(false);
    });
  });
});
