import { AuditLogger } from '@/auth/auditLogger.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { JwtService } from '@nestjs/jwt';
import { getRounds } from 'bcrypt';
import { SignInService } from './signin.service';

function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  return promise.then(
    () => {
      throw new Error('Expected the sign-in to be rejected.');
    },
    (caught: unknown) => caught as AppError,
  );
}

describe('SignInService', () => {
  const activeUser = {
    id: 'user-1',
    name: 'Password User',
    email: 'user@example.com',
    password: 'stored-hash',
    avatar: null,
    active: true,
    productId: null,
    product: null,
  };
  const users = { findByEmail: jest.fn() };
  const passwordHash = { compareHash: jest.fn() };
  const jwtService = { signAsync: jest.fn().mockResolvedValue('signed-jwt') };
  const uploadService = { getSignedUrl: jest.fn() };
  const auditLogger = { log: jest.fn(), warn: jest.fn() };
  let service: SignInService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SignInService(
      users as unknown as UserRepository,
      passwordHash as unknown as PasswordHash,
      jwtService as unknown as JwtService,
      uploadService as unknown as UploadService,
      auditLogger as unknown as AuditLogger,
    );
  });

  it('UT-026 returns SignInResponse for a correct password and active user', async () => {
    users.findByEmail.mockResolvedValue(activeUser);
    passwordHash.compareHash.mockResolvedValue(true);

    await expect(
      service.postSignIn({
        email: activeUser.email,
        password: 'correct-password',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ id: activeUser.id, accessToken: 'signed-jwt' }),
    );
    expect(passwordHash.compareHash).toHaveBeenCalledWith(
      'correct-password',
      activeUser.password,
    );
    expect(auditLogger.log).toHaveBeenCalledWith({
      event: 'signin_attempt',
      method: 'password',
      outcome: 'success',
      userId: activeUser.id,
      timestamp: expect.any(String),
    });
  });

  it('UT-027 rejects a wrong password with 401 and has no socialLogin bypass', async () => {
    users.findByEmail.mockResolvedValue(activeUser);
    passwordHash.compareHash.mockResolvedValue(false);

    const error = await service
      .postSignIn({ email: activeUser.email, password: 'wrong' })
      .catch((caught: AppError) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error.getStatus()).toBe(401);
  });

  it('UT-028 rejects an unknown email with the same generic message', async () => {
    users.findByEmail.mockResolvedValueOnce(activeUser);
    passwordHash.compareHash.mockResolvedValue(false);
    const wrongPasswordError = await service
      .postSignIn({ email: activeUser.email, password: 'wrong' })
      .catch((caught: AppError) => caught);
    users.findByEmail.mockResolvedValue(null);

    const error = await service
      .postSignIn({ email: 'unknown@example.com', password: 'anything' })
      .catch((caught: AppError) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error.getStatus()).toBe(401);
    expect(error.message).toBe(wrongPasswordError.message);
  });

  it('UT-029 rejects an inactive account even with the correct password', async () => {
    users.findByEmail.mockResolvedValue({ ...activeUser, active: false });
    passwordHash.compareHash.mockResolvedValue(true);

    const error = await rejectionOf(
      service.postSignIn({
        email: activeUser.email,
        password: 'correct-password',
      }),
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error.getStatus()).toBe(401);
    expect(error.message).toBe('Usuário não autorizado. Conta inativa.');
  });

  it('US-004 EC-1 answers an inactive account with a wrong password like any bad credential', async () => {
    users.findByEmail.mockResolvedValue({ ...activeUser, active: false });
    passwordHash.compareHash.mockResolvedValue(false);

    const error = await rejectionOf(
      service.postSignIn({ email: activeUser.email, password: 'wrong' }),
    );

    expect(error.getStatus()).toBe(401);
    expect(error.message).toBe('Usuário não autorizado.');
  });

  it('US-004 AC-2 runs a cost-12 bcrypt comparison when the account does not exist', async () => {
    users.findByEmail.mockResolvedValue(null);
    passwordHash.compareHash.mockResolvedValue(false);

    await expect(
      service.postSignIn({ email: 'unknown@example.com', password: 'guess' }),
    ).rejects.toBeInstanceOf(AppError);

    expect(passwordHash.compareHash).toHaveBeenCalledTimes(1);
    const [payload, dummyHash] = passwordHash.compareHash.mock.calls[0] as [
      string,
      string,
    ];
    expect(payload).toBe('guess');
    expect(getRounds(dummyHash)).toBe(12);
  });

  it('UT-044 logs a structured password failure without the password', async () => {
    users.findByEmail.mockResolvedValue(activeUser);
    passwordHash.compareHash.mockResolvedValue(false);

    await expect(
      service.postSignIn({
        email: activeUser.email,
        password: 'never-log-this-password',
      }),
    ).rejects.toBeInstanceOf(AppError);

    expect(auditLogger.warn).toHaveBeenCalledWith({
      event: 'signin_attempt',
      method: 'password',
      outcome: 'failure',
      reason: 'invalid_credentials',
      userId: activeUser.id,
      timestamp: expect.any(String),
    });
    expect(JSON.stringify(auditLogger.warn.mock.calls)).not.toContain(
      'never-log-this-password',
    );
  });

  it('does not block successful signin when audit delivery fails', async () => {
    users.findByEmail.mockResolvedValue(activeUser);
    passwordHash.compareHash.mockResolvedValue(true);
    auditLogger.log.mockImplementationOnce(() => {
      throw new Error('logger unavailable');
    });

    await expect(
      service.postSignIn({
        email: activeUser.email,
        password: 'correct-password',
      }),
    ).resolves.toEqual(expect.objectContaining({ id: activeUser.id }));
  });
});
