import { ProductTier } from '@prisma/client';

export function tierOf(plan: { name: string; price: number }): ProductTier {
  if (plan.price === 0) return ProductTier.FREE;
  if (plan.name === 'Premium') return ProductTier.PREMIUM;
  return ProductTier.STANDARD;
}
