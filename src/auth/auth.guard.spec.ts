import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  const jwtService = { verifyAsync: jest.fn() };
  const users = { findUnique: jest.fn() };
  let guard: AuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new AuthGuard(
      jwtService as unknown as JwtService,
      users as unknown as UserRepository,
    );
  });

  function context(authorization?: string) {
    const request: {
      headers: { authorization?: string };
      user?: Record<string, unknown>;
    } = { headers: { authorization } };
    return {
      request,
      executionContext: {
        switchToHttp: () => ({ getRequest: () => request }),
      } as ExecutionContext,
    };
  }

  async function expectUnauthorized(executionContext: ExecutionContext) {
    const error = await guard
      .canActivate(executionContext)
      .catch((caught: AppError) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error.getStatus()).toBe(401);
  }

  it('UT-030 returns 401 when the Authorization header is missing', async () => {
    await expectUnauthorized(context().executionContext);
  });

  it('UT-031 returns 401 when JWT verification fails', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('expired token'));

    await expectUnauthorized(context('Bearer invalid').executionContext);
  });

  it('UT-032 returns 401 when the JWT user no longer exists', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      id: 'deleted-user',
      email: 'deleted@example.com',
    });
    users.findUnique.mockResolvedValue(null);

    await expectUnauthorized(context('Bearer valid').executionContext);
  });

  it('UT-033 returns 401 when the JWT email differs from the stored user', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      id: 'user-1',
      email: 'old@example.com',
    });
    users.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'new@example.com',
      password: 'secret-hash',
    });

    await expectUnauthorized(context('Bearer valid').executionContext);
  });

  it('UT-034 allows a matching user and removes the password', async () => {
    const payload = { id: 'user-1', email: 'user@example.com' };
    const storedUser = { ...payload, name: 'User', password: 'secret-hash' };
    jwtService.verifyAsync.mockResolvedValue(payload);
    users.findUnique.mockResolvedValue(storedUser);
    const { request, executionContext } = context('Bearer valid');

    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(request.user).toEqual({ ...storedUser, password: undefined });
  });
});
