import { AppError } from '@/utils/app.erro';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

const OWNER_ONLY = 'Acesso restrito ao dono/gestor da academia.';

@Injectable()
export class AcademiaOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { academiaId?: string | null } }>();

    if (!request.user?.academiaId) {
      throw new AppError(OWNER_ONLY, 403, 'not_academia_owner');
    }

    return true;
  }
}
