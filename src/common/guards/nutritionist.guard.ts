import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ProductType } from '@prisma/client';
import type { AuthenticatedRequest } from '../types/authenticatedRequest';

const NUTRITIONIST_ONLY = 'Apenas nutricionistas podem acessar este recurso.';

// Scoped to ProductType.NUTRITIONIST only — ProfessionalGuard's
// nutritionist-or-educator check is too broad for the nutritionist's own
// patient registration (US-001/US-002), which a physical educator account
// must not reach. Mirrors ProfessionalGuard's exact shape.
@Injectable()
export class NutritionistGuard implements CanActivate {
  constructor(private readonly users: UserRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.users.findByIdWithProduct(request.user.id);
    const type = user?.product?.type;

    if (type !== ProductType.NUTRITIONIST) {
      throw new AppError(NUTRITIONIST_ONLY, 403, 'not_nutritionist');
    }

    return true;
  }
}
