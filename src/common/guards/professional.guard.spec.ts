import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { ExecutionContext } from '@nestjs/common';
import { Product, Users } from '@prisma/client';
import { ProfessionalGuard } from './professional.guard';

function makeUser(overrides: Partial<Users> = {}): Users {
  const timestamp = new Date('2026-10-01T09:00:00.000Z');
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
    name: 'Nutricionista',
    price: 49,
    groupId: 'group-1',
    type: 'NUTRITIONIST',
    stripeId: null,
    createdAt: new Date('2026-10-01T09:00:00.000Z'),
    updatedAt: new Date('2026-10-01T09:00:00.000Z'),
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

describe('ProfessionalGuard', () => {
  const findByIdWithProduct = jest.fn();
  const guard = new ProfessionalGuard({
    findByIdWithProduct,
  } as unknown as UserRepository);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows a NUTRITIONIST account', async () => {
    findByIdWithProduct.mockResolvedValue({
      ...makeUser(),
      product: makeProduct({ type: 'NUTRITIONIST' }),
    });

    await expect(guard.canActivate(contextFor('user-1'))).resolves.toBe(true);
  });

  it('allows a PHYSICAL_EDUCATOR account', async () => {
    findByIdWithProduct.mockResolvedValue({
      ...makeUser(),
      product: makeProduct({ type: 'PHYSICAL_EDUCATOR' }),
    });

    await expect(guard.canActivate(contextFor('user-1'))).resolves.toBe(true);
  });

  it('denies a plain USER account with AppError(403)', async () => {
    findByIdWithProduct.mockResolvedValue({
      ...makeUser(),
      product: makeProduct({ type: 'USER' }),
    });

    await expect(guard.canActivate(contextFor('user-1'))).rejects.toThrow(
      AppError,
    );
    try {
      await guard.canActivate(contextFor('user-1'));
    } catch (error) {
      expect((error as AppError).getStatus()).toBe(403);
    }
  });

  it('denies a user with no product at all', async () => {
    findByIdWithProduct.mockResolvedValue({ ...makeUser(), product: null });

    await expect(guard.canActivate(contextFor('user-1'))).rejects.toThrow(
      AppError,
    );
  });

  it('denies when the user cannot be found', async () => {
    findByIdWithProduct.mockResolvedValue(null);

    await expect(guard.canActivate(contextFor('user-1'))).rejects.toThrow(
      AppError,
    );
  });
});
