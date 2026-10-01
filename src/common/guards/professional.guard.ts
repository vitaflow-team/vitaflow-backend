import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ProductType } from '@prisma/client';
import type { AuthenticatedRequest } from '../types/authenticatedRequest';

const PROFESSIONAL_ONLY =
  'Apenas nutricionistas e educadores físicos podem acessar este recurso.';

// Must run after AuthGuard, which populates req.user. Mirrors PremiumGuard's
// shape: re-fetch with the product join rather than trust anything beyond
// `id` on req.user (AuthenticatedRequest only types that field).
@Injectable()
export class ProfessionalGuard implements CanActivate {
  constructor(private readonly users: UserRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.users.findByIdWithProduct(request.user.id);
    const type = user?.product?.type;

    if (
      type !== ProductType.NUTRITIONIST &&
      type !== ProductType.PHYSICAL_EDUCATOR
    ) {
      throw new AppError(PROFESSIONAL_ONLY, 403, 'not_professional');
    }

    return true;
  }
}
