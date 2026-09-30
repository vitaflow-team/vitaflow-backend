import { AppError } from '@/utils/app.erro';
import { ExecutionContext } from '@nestjs/common';
import { BackofficeGuard } from './backoffice.guard';

function contextFor(user?: { isBackoffice?: boolean }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as ExecutionContext;
}

describe('BackofficeGuard', () => {
  const guard = new BackofficeGuard();

  it('denies an authenticated user who is not backoffice staff with 403', () => {
    const attempt = () =>
      guard.canActivate(contextFor({ isBackoffice: false }));

    expect(attempt).toThrow(AppError);
    expect(attempt).toThrow('Acesso restrito à equipe Vita Flow.');
    try {
      attempt();
    } catch (error) {
      expect((error as AppError).getStatus()).toBe(403);
    }
  });

  it('allows backoffice staff', () => {
    expect(guard.canActivate(contextFor({ isBackoffice: true }))).toBe(true);
  });

  it('denies safely with 403 when AuthGuard has not populated req.user', () => {
    const attempt = () => guard.canActivate(contextFor(undefined));

    expect(attempt).toThrow(AppError);
    try {
      attempt();
    } catch (error) {
      expect((error as AppError).getStatus()).toBe(403);
    }
  });
});
