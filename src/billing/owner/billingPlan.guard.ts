import { planRequirement } from '@/billing/shared/premiumAccess';
import { CodedError } from '@/common/errors/codedError';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { UserRepository } from '@/repositories/users/user.repository';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BillingOwnerService } from './billingOwner.service';

// Billing mutations need a plan that can bill: Premium for a professional, a
// paid subscription for a gym owner. Replaces ProfessionalPremiumGuard on the
// billing routes; must run after AuthGuard and BillingOwnerGuard.
@Injectable()
export class BillingPlanGuard implements CanActivate {
  constructor(
    private readonly users: UserRepository,
    private readonly owners: BillingOwnerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.users.findByIdWithProduct(request.user.id);

    if (!this.owners.canBill(user)) {
      const { message, code } = planRequirement(user);
      throw new CodedError(message, 403, code);
    }
    return true;
  }
}
