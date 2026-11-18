import type { BillingSubject } from '@/billing/owner/types/billingSubject';
import { PAID_STATUSES } from '@/users/subscription/subscriptionExpiry';
import { ProductTier, ProductType } from '@prisma/client';

const PROFESSIONAL_TYPES: ProductType[] = [
  ProductType.PHYSICAL_EDUCATOR,
  ProductType.NUTRITIONIST,
];

const PREMIUM_MESSAGE = 'Este recurso requer o plano Premium.';
const SUBSCRIPTION_MESSAGE =
  'Este recurso requer uma assinatura ativa da academia.';

// The billing tier of a professional: a premium plan with a paid subscription.
export function isProfessionalPremium(user: BillingSubject | null): boolean {
  return (
    user !== null &&
    user.product !== null &&
    PROFESSIONAL_TYPES.includes(user.product.type) &&
    user.product.tier === ProductTier.PREMIUM &&
    hasPaidSubscription(user)
  );
}

// The billing tier of a gym owner: any academia plan with a paid
// subscription (ADR-008).
export function isGymBillingActive(user: BillingSubject | null): boolean {
  return (
    user !== null &&
    user.product !== null &&
    user.product.type === ProductType.ACADEMIA &&
    hasPaidSubscription(user)
  );
}

// Whether the user's plan allows billing at all: the Premium rule for
// professionals, a paid subscription for gym owners.
export function canBill(user: BillingSubject | null): boolean {
  return isProfessionalPremium(user) || isGymBillingActive(user);
}

// The coded refusal for a user whose plan cannot bill: gym owners are asked
// for a subscription, everyone else for Premium.
export function planRequirement(user: BillingSubject | null): {
  message: string;
  code: 'premium_required' | 'subscription_required';
} {
  if (user?.product?.type === ProductType.ACADEMIA) {
    return { message: SUBSCRIPTION_MESSAGE, code: 'subscription_required' };
  }
  return { message: PREMIUM_MESSAGE, code: 'premium_required' };
}

function hasPaidSubscription(user: BillingSubject): boolean {
  return (
    user.subscriptionStatus !== null &&
    PAID_STATUSES.includes(user.subscriptionStatus)
  );
}
