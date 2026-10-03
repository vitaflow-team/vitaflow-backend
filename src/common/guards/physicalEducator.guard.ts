import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ProductType } from '@prisma/client';
import type { AuthenticatedRequest } from '../types/authenticatedRequest';

const EDUCATOR_ONLY = 'Apenas educadores físicos podem acessar este recurso.';

// Must run after AuthGuard, which populates req.user. Same shape as
// ProfessionalGuard but narrower: only physical educators pass. The type is
// read from the database, never trusted from the token.
@Injectable()
export class PhysicalEducatorGuard implements CanActivate {
  constructor(private readonly users: UserRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.users.findByIdWithProduct(request.user.id);

    if (user?.product?.type !== ProductType.PHYSICAL_EDUCATOR) {
      throw new AppError(EDUCATOR_ONLY, 403, 'not_physical_educator');
    }

    return true;
  }
}
