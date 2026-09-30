import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Product, Users } from '@prisma/client';
import { PAID_STATUSES } from '@/users/subscription/subscriptionExpiry';
import type { AuthenticatedRequest } from '../types/authenticatedRequest';

const PREMIUM_REQUIRED = 'Este recurso requer o plano Premium.';

// "Premium" reuses the same definition `subscriptionExpiry.ts` already uses
// for a paid plan: an active/trialing/past_due subscription against a
// non-zero-price product — not simply `Product.price > 0` on its own.
export interface PremiumCheckInput {
  subscriptionStatus: string | null;
  productPrice: number | null;
}

export function isPremiumUser(input: PremiumCheckInput): boolean {
  return (
    input.subscriptionStatus !== null &&
    PAID_STATUSES.includes(input.subscriptionStatus) &&
    (input.productPrice ?? 0) > 0
  );
}

// Shared Premium gate (ADR-007), used both as a route guard (Progress
// Photos, whose entire controller is Premium-only) and as a plain
// injectable collaborator (the AI Workout Generator's regeneration check,
// which is conditional on prior workout existence and so cannot be a
// route-level guard). `isPremium` takes an already-loaded user so a caller
// that already fetched `findByIdWithProduct` never pays for a second query.
@Injectable()
export class PremiumGuard implements CanActivate {
  constructor(private readonly users: UserRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.users.findByIdWithProduct(request.user.id);

    if (!user || !this.isPremium(user)) {
      throw new AppError(PREMIUM_REQUIRED, 402, 'premium_required');
    }

    return true;
  }

  isPremium(user: Users & { product: Product | null }): boolean {
    return isPremiumUser({
      subscriptionStatus: user.subscriptionStatus,
      productPrice: user.product?.price ?? null,
    });
  }
}
