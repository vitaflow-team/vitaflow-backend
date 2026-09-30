import { AppError } from '@/utils/app.erro';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

const BACKOFFICE_ONLY = 'Acesso restrito à equipe Vita Flow.';

// Restricts a route to Vita Flow internal staff (`Users.isBackoffice`).
// It reads `req.user`, which only AuthGuard populates, so it must always run
// after it: `@UseGuards(AuthGuard, BackofficeGuard)` — never on its own.
// A request that reaches it without an authenticated user is denied, not
// crashed.
@Injectable()
export class BackofficeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { isBackoffice?: boolean } }>();

    if (request.user?.isBackoffice !== true) {
      throw new AppError(BACKOFFICE_ONLY, 403, 'not_backoffice');
    }

    return true;
  }
}
