import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { buildJwtOptions } from './jwtOptions';

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

describe('AuthGuard with the AuthModule JWT configuration (UT-002)', () => {
  const secret = 'ut-002-jwt-secret-with-at-least-32-characters';
  const payload = { id: 'user-1', email: 'user@example.com' };
  const users = { findUnique: jest.fn() };
  const jwtService = new JwtService(buildJwtOptions(secret));
  const guard = new AuthGuard(jwtService, users as unknown as UserRepository);
  const previousSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = secret;
  });

  afterAll(() => {
    process.env.JWT_SECRET = previousSecret;
  });

  beforeEach(() => {
    users.findUnique.mockResolvedValue({ ...payload, password: 'hash' });
  });

  function contextFor(token: string): ExecutionContext {
    const request = { headers: { authorization: `Bearer ${token}` } };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;
  }

  async function expectRejected(token: string) {
    const error = await guard
      .canActivate(contextFor(token))
      .catch((caught: AppError) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).getStatus()).toBe(401);
  }

  it('signs with HS256 and a 2h expiry, and the guard accepts the token', async () => {
    const token = await jwtService.signAsync(payload);
    const decoded = jwtService.decode<{
      header: { alg: string };
      payload: { iat: number; exp: number };
    }>(token, { complete: true });

    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.payload.exp - decoded.payload.iat).toBe(2 * 60 * 60);
    await expect(guard.canActivate(contextFor(token))).resolves.toBe(true);
  });

  it.each(['HS384', 'HS512'] as const)(
    'rejects a token signed with %s, even with the right secret',
    async (algorithm) => {
      const token = await new JwtService({ secret }).signAsync(payload, {
        algorithm,
      });

      await expectRejected(token);
    },
  );

  it('rejects an unsigned alg=none token', async () => {
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      ...payload,
      iat: now,
      exp: now + 60,
    })}.`;

    await expectRejected(token);
  });
});
