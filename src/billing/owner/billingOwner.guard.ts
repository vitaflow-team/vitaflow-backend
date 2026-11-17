import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { UserRepository } from '@/repositories/users/user.repository';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BillingOwnerService } from './billingOwner.service';
import { notBillingOwner } from './billingOwnerRules';
import type { BillingOwnerRequest } from './types/billingOwnerRequest';

// Replaces ProfessionalGuard on the billing routes (ADR-008). Must run after
// AuthGuard: it re-fetches the user with the product join rather than trust
// anything beyond `id` on req.user, resolves the billing owner and leaves it
// on the request for the controller.
@Injectable()
export class BillingOwnerGuard implements CanActivate {
  constructor(
    private readonly users: UserRepository,
    private readonly owners: BillingOwnerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.users.findByIdWithProduct(request.user.id);
    if (!user) throw notBillingOwner();

    (request as BillingOwnerRequest).billingOwner = this.owners.resolve(user);
    return true;
  }
}
