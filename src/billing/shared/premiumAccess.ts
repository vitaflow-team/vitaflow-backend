import { PAID_STATUSES } from '@/users/subscription/subscriptionExpiry';
import { Product, ProductTier, ProductType, Users } from '@prisma/client';

const PROFESSIONAL_TYPES: ProductType[] = [
  ProductType.PHYSICAL_EDUCATOR,
  ProductType.NUTRITIONIST,
];

// The billing tier of a professional: a premium plan with a paid subscription.
export function isProfessionalPremium(
  user: (Users & { product: Product | null }) | null,
): boolean {
  return (
    user !== null &&
    user.product !== null &&
    PROFESSIONAL_TYPES.includes(user.product.type) &&
    user.product.tier === ProductTier.PREMIUM &&
    user.subscriptionStatus !== null &&
    PAID_STATUSES.includes(user.subscriptionStatus)
  );
}
