import { isProfessionalPremium } from '@/billing/shared/premiumAccess';
import { CodedError } from '@/common/errors/codedError';
import { UserRepository } from '@/repositories/users/user.repository';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../types/authenticatedRequest';

// Billing is a Premium feature of the professional (ADR-005). Must run after
// AuthGuard. The existing PremiumGuard is unchanged and keeps its users.
@Injectable()
export class ProfessionalPremiumGuard implements CanActivate {
  constructor(private readonly users: UserRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.users.findByIdWithProduct(request.user.id);

    if (!isProfessionalPremium(user)) {
      throw new CodedError(
        'Este recurso requer o plano Premium.',
        403,
        'premium_required',
      );
    }
    return true;
  }
}
