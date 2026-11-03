import { ProductTier } from '@prisma/client';
import { tierOf } from './productTier';

describe('plan tiers (UT-107)', () => {
  it('sets free, premium and standard tiers from the plan', () => {
    expect(tierOf({ name: 'Gratuito', price: 0 })).toBe(ProductTier.FREE);
    expect(tierOf({ name: 'Premium', price: 19.9 })).toBe(ProductTier.PREMIUM);
    expect(tierOf({ name: 'Profissional', price: 59.9 })).toBe(
      ProductTier.STANDARD,
    );
  });
});
