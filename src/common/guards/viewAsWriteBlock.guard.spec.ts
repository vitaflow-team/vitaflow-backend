import { BackofficeViewAsSessionRepository } from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ViewAsWriteBlockGuard } from './viewAsWriteBlock.guard';

const VIEW_AS_PAYLOAD = {
  sub: 'target-1',
  targetKind: 'USER' as const,
  actingStaffId: 'staff-1',
  viewAsSessionId: 'session-1',
  exp: Math.floor(Date.now() / 1000) + 1800,
};

function contextFor(
  method: string,
  token: string | undefined,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('ViewAsWriteBlockGuard — platform-admin-access UT-010 through UT-014', () => {
  const verifyAsync = jest.fn();
  const findUnique = jest.fn();
  const findById = jest.fn();
  const getAllAndOverride = jest.fn();

  const guard = new ViewAsWriteBlockGuard(
    { getAllAndOverride } as unknown as Reflector,
    { findUnique } as unknown as UserRepository,
    { findById } as unknown as BackofficeViewAsSessionRepository,
    { verifyAsync } as unknown as JwtService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    getAllAndOverride.mockReturnValue(false);
  });

  it('allows a request with no Authorization header at all', async () => {
    await expect(guard.canActivate(contextFor('GET', undefined))).resolves.toBe(
      true,
    );
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it("allows a request whose token fails verification (not this guard's job)", async () => {
    verifyAsync.mockRejectedValue(new Error('invalid signature'));

    await expect(
      guard.canActivate(contextFor('POST', 'garbage')),
    ).resolves.toBe(true);
  });

  it('allows a normal (non-view-as) token on any verb', async () => {
    verifyAsync.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });

    await expect(guard.canActivate(contextFor('POST', 'normal'))).resolves.toBe(
      true,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  describe('a view-as token', () => {
    beforeEach(() => {
      verifyAsync.mockResolvedValue(VIEW_AS_PAYLOAD);
      findUnique.mockResolvedValue({ isBackoffice: true });
      findById.mockResolvedValue({ endedAt: null });
    });

    it('UT-010: allows a GET request when the session is open and staff still backoffice', async () => {
      await expect(guard.canActivate(contextFor('GET', 'tok'))).resolves.toBe(
        true,
      );
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
      'UT-011: rejects a %s request to any route other than the end-session endpoint, with 403',
      async (method) => {
        await expect(
          guard.canActivate(contextFor(method, 'tok')),
        ).rejects.toThrow(AppError);
        try {
          await guard.canActivate(contextFor(method, 'tok'));
        } catch (error) {
          expect((error as AppError).getStatus()).toBe(403);
        }
      },
    );

    it('UT-012: allows a POST to the end-session endpoint itself (marked @AllowDuringViewAs)', async () => {
      getAllAndOverride.mockReturnValue(true);

      await expect(guard.canActivate(contextFor('POST', 'tok'))).resolves.toBe(
        true,
      );
    });

    it('UT-013: rejects when the acting staff member no longer has isBackoffice true, even on GET', async () => {
      findUnique.mockResolvedValue({ isBackoffice: false });

      await expect(guard.canActivate(contextFor('GET', 'tok'))).rejects.toThrow(
        AppError,
      );
    });

    it('UT-013 (end-session exception still dual-revalidates): a removed staff member is rejected even hitting the exempted endpoint', async () => {
      getAllAndOverride.mockReturnValue(true);
      findUnique.mockResolvedValue({ isBackoffice: false });

      await expect(
        guard.canActivate(contextFor('POST', 'tok')),
      ).rejects.toThrow(AppError);
    });

    it('UT-014: rejects when the session has already been manually ended, even on GET', async () => {
      findById.mockResolvedValue({ endedAt: new Date() });

      await expect(guard.canActivate(contextFor('GET', 'tok'))).rejects.toThrow(
        AppError,
      );
    });

    it('UT-014 (end-session exception still dual-revalidates): an already-ended session is rejected even hitting the exempted endpoint', async () => {
      getAllAndOverride.mockReturnValue(true);
      findById.mockResolvedValue({ endedAt: new Date() });

      await expect(
        guard.canActivate(contextFor('POST', 'tok')),
      ).rejects.toThrow(AppError);
    });

    it('rejects when the session id no longer resolves to any row at all', async () => {
      findById.mockResolvedValue(null);

      await expect(guard.canActivate(contextFor('GET', 'tok'))).rejects.toThrow(
        AppError,
      );
    });
  });
});
