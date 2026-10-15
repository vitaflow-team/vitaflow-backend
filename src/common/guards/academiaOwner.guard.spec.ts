import { ExecutionContext } from '@nestjs/common';
import { AppError } from '@/utils/app.erro';
import { AcademiaOwnerGuard } from './academiaOwner.guard';

function contextFor(academiaId: string | null | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { academiaId } }),
    }),
  } as ExecutionContext;
}

describe('AcademiaOwnerGuard', () => {
  const guard = new AcademiaOwnerGuard();

  it('UT-034 allows a request whose Users row has academiaId set', () => {
    expect(guard.canActivate(contextFor('academia-1'))).toBe(true);
  });

  it.each([
    ['null (non-owner account)', null],
    ['undefined (no field at all)', undefined],
  ])('UT-035 rejects a request with academiaId %s', (_label, academiaId) => {
    const attempt = () => guard.canActivate(contextFor(academiaId));

    expect(attempt).toThrow(AppError);
    try {
      attempt();
    } catch (error) {
      expect((error as AppError).getStatus()).toBe(403);
      expect((error as AppError).reason).toBe('not_academia_owner');
    }
  });
});
