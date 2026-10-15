import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BackofficeTier } from '@prisma/client';
import type { AuthenticatedRequest } from '../types/authenticatedRequest';

const ADMIN_ONLY = 'Acesso restrito a administradores internos.';

// Must run after AuthGuard and BackofficeGuard. Mirrors ProfessionalGuard's
// shape: re-fetch rather than trust anything beyond `id` on req.user, so a
// demotion takes effect on the very next request regardless of what the
// caller's own JWT still claims.
@Injectable()
export class AdminTierGuard implements CanActivate {
  constructor(private readonly users: UserRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.users.findUnique({ id: request.user.id });

    if (user?.backofficeTier !== BackofficeTier.ADMIN) {
      throw new AppError(ADMIN_ONLY, 403, 'not_admin_interno');
    }

    return true;
  }
}
