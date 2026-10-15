import { ExecutionContext } from '@nestjs/common';
import { AppError } from '@/utils/app.erro';
import { ReceptionistAuthGuard } from './receptionistAuth.guard';

function contextWithToken(token?: string): ExecutionContext {
  const request = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    user: undefined as unknown,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('ReceptionistAuthGuard', () => {
  function makeDeps() {
    return {
      jwtService: {
        verifyAsync: jest
          .fn()
          .mockResolvedValue({ id: 'staff-1', email: 'recepcao@example.com' }),
      },
      staff: {
        findById: jest.fn().mockResolvedValue({
          id: 'staff-1',
          email: 'recepcao@example.com',
          academiaId: 'academia-1',
          active: true,
        }),
      },
    };
  }

  it('UT-032 allows a valid token whose live AcademiaStaffMember is active, sets request.user', async () => {
    const deps = makeDeps();
    const guard = new ReceptionistAuthGuard(
      deps.jwtService as never,
      deps.staff as never,
    );
    const context = contextWithToken('valid.jwt');
    const request = context.switchToHttp().getRequest<{ user?: unknown }>();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'staff-1',
      academiaId: 'academia-1',
      role: 'RECEPTIONIST',
    });
  });

  it('UT-033 rejects when the live staff row is now inactive, independent of what the token claims', async () => {
    const deps = makeDeps();
    deps.staff.findById.mockResolvedValue({
      id: 'staff-1',
      email: 'recepcao@example.com',
      academiaId: 'academia-1',
      active: false,
    });
    const guard = new ReceptionistAuthGuard(
      deps.jwtService as never,
      deps.staff as never,
    );

    await expect(
      guard.canActivate(contextWithToken('valid.jwt')),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('UT-033 rejects when the staff row no longer exists (deleted/removed)', async () => {
    const deps = makeDeps();
    deps.staff.findById.mockResolvedValue(null);
    const guard = new ReceptionistAuthGuard(
      deps.jwtService as never,
      deps.staff as never,
    );

    await expect(
      guard.canActivate(contextWithToken('valid.jwt')),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a request with no bearer token at all', async () => {
    const deps = makeDeps();
    const guard = new ReceptionistAuthGuard(
      deps.jwtService as never,
      deps.staff as never,
    );

    await expect(guard.canActivate(contextWithToken())).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it('rejects an unverifiable (bad signature) token', async () => {
    const deps = makeDeps();
    deps.jwtService.verifyAsync.mockRejectedValue(new Error('bad signature'));
    const guard = new ReceptionistAuthGuard(
      deps.jwtService as never,
      deps.staff as never,
    );

    await expect(
      guard.canActivate(contextWithToken('tampered.jwt')),
    ).rejects.toBeInstanceOf(AppError);
  });
});
