import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ProductType } from '@prisma/client';
import type { AuthenticatedRequest } from '../types/authenticatedRequest';

const USER_ONLY = 'Apenas contas de aluno podem acessar este recurso.';

@Injectable()
export class GymStudentGuard implements CanActivate {
  constructor(private readonly users: UserRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.users.findByIdWithProduct(request.user.id);

    if (user?.product?.type !== ProductType.USER) {
      throw new AppError(USER_ONLY, 403, 'not_gym_student');
    }

    return true;
  }
}
