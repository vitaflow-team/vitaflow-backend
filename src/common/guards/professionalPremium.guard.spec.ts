import { CodedError } from '@/common/errors/codedError';
import { UserRepository } from '@/repositories/users/user.repository';
import { ExecutionContext } from '@nestjs/common';
import { ProductTier, ProductType } from '@prisma/client';
import { ProfessionalPremiumGuard } from './professionalPremium.guard';

function userWith(
  type: ProductType,
  tier: ProductTier,
  subscriptionStatus: string | null,
) {
  return {
    id: 'user-1',
    subscriptionStatus,
    product: { id: 'p', type, tier, price: 59.9 },
  };
}

function contextFor(): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'user-1' } }) }),
  } as unknown as ExecutionContext;
}

async function outcome(user: unknown): Promise<unknown> {
  const users = {
    findByIdWithProduct: jest.fn().mockResolvedValue(user),
  } as unknown as UserRepository;
  try {
    return await new ProfessionalPremiumGuard(users).canActivate(contextFor());
  } catch (error) {
    return error;
  }
}

describe('ProfessionalPremiumGuard (UT-025)', () => {
  it('allows an educator and a nutritionist on a premium plan with a paid subscription', async () => {
    expect(
      await outcome(
        userWith(ProductType.PHYSICAL_EDUCATOR, ProductTier.PREMIUM, 'active'),
      ),
    ).toBe(true);
    expect(
      await outcome(
        userWith(ProductType.NUTRITIONIST, ProductTier.PREMIUM, 'trialing'),
      ),
    ).toBe(true);
  });

  it('refuses a standard plan, a canceled premium subscription, a regular user and an unknown user with premium_required', async () => {
    const refused = [
      userWith(ProductType.PHYSICAL_EDUCATOR, ProductTier.STANDARD, 'active'),
      userWith(ProductType.PHYSICAL_EDUCATOR, ProductTier.FREE, 'active'),
      userWith(ProductType.PHYSICAL_EDUCATOR, ProductTier.PREMIUM, 'canceled'),
      userWith(ProductType.USER, ProductTier.PREMIUM, 'active'),
      null,
    ];
    for (const user of refused) {
      const error = await outcome(user);
      expect(error).toBeInstanceOf(CodedError);
      expect((error as CodedError).getStatus()).toBe(403);
      expect((error as CodedError).code).toBe('premium_required');
    }
  });
});
