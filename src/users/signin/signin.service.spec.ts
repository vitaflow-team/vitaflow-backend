import { AcademiaStaffAuthService } from '@/academia/staff/academiaStaffAuth.service';
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
  const users = { findAllByEmail: jest.fn() };
  const academiaStaff = { findByEmail: jest.fn().mockResolvedValue(null) };
  const passwordHash = { compareHash: jest.fn() };
  const jwtService = { signAsync: jest.fn().mockResolvedValue('signed-jwt') };
  const uploadService = { getSignedUrl: jest.fn() };
  const auditLogger = { log: jest.fn(), warn: jest.fn() };
  let service: SignInService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SignInService(
      users as unknown as UserRepository,
      academiaStaff as unknown as AcademiaStaffAuthService,
      passwordHash as unknown as PasswordHash,
      jwtService as unknown as JwtService,
      uploadService as unknown as UploadService,
      auditLogger as unknown as AuditLogger,
    );
  });

  it('UT-026 returns SignInResponse for a correct password and active user', async () => {
    users.findAllByEmail.mockResolvedValue([activeUser]);
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
    users.findAllByEmail.mockResolvedValue([activeUser]);
    passwordHash.compareHash.mockResolvedValue(false);

    const error = await service
      .postSignIn({ email: activeUser.email, password: 'wrong' })
      .catch((caught: AppError) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error.getStatus()).toBe(401);
  });

  it('UT-028 rejects an unknown email with the same generic message', async () => {
    users.findAllByEmail.mockResolvedValueOnce([activeUser]);
    passwordHash.compareHash.mockResolvedValue(false);
    const wrongPasswordError = await service
      .postSignIn({ email: activeUser.email, password: 'wrong' })
      .catch((caught: AppError) => caught);
    users.findAllByEmail.mockResolvedValue([]);

    const error = await service
      .postSignIn({ email: 'unknown@example.com', password: 'anything' })
      .catch((caught: AppError) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error.getStatus()).toBe(401);
    expect(error.message).toBe(wrongPasswordError.message);
  });

  it('UT-029 rejects an inactive account even with the correct password', async () => {
    users.findAllByEmail.mockResolvedValue([{ ...activeUser, active: false }]);
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
    users.findAllByEmail.mockResolvedValue([{ ...activeUser, active: false }]);
    passwordHash.compareHash.mockResolvedValue(false);

    const error = await rejectionOf(
      service.postSignIn({ email: activeUser.email, password: 'wrong' }),
    );

    expect(error.getStatus()).toBe(401);
    expect(error.message).toBe('Usuário não autorizado.');
  });

  it('US-004 AC-2 runs a cost-12 bcrypt comparison when the account does not exist', async () => {
    users.findAllByEmail.mockResolvedValue([]);
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

  describe('same-email coexistence (platform-admin-access ADR-005)', () => {
    const olderUser = {
      id: 'user-1',
      name: 'Customer User',
      email: 'shared@example.com',
      password: 'customer-hash',
      avatar: null,
      active: true,
      productId: null,
      product: null,
    };
    const newerStaffUser = {
      id: 'staff-user-1',
      name: 'Staff User',
      email: 'shared@example.com',
      password: 'staff-hash',
      avatar: null,
      active: true,
      productId: null,
      product: null,
    };

    it('authenticates the older row when its password matches (first in the list)', async () => {
      users.findAllByEmail.mockResolvedValue([olderUser, newerStaffUser]);
      passwordHash.compareHash.mockImplementation((_password, hash) =>
        Promise.resolve(hash === olderUser.password),
      );

      const response = await service.postSignIn({
        email: olderUser.email,
        password: 'customer-password',
      });

      expect(response).toEqual(
        expect.objectContaining({
          id: olderUser.id,
          accessToken: 'signed-jwt',
        }),
      );
      expect(passwordHash.compareHash).toHaveBeenCalledTimes(1);
      expect(passwordHash.compareHash).toHaveBeenNthCalledWith(
        1,
        'customer-password',
        olderUser.password,
      );
      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'success', userId: olderUser.id }),
      );
    });

    it('authenticates the newer row when its password matches, after the older row fails', async () => {
      users.findAllByEmail.mockResolvedValue([olderUser, newerStaffUser]);
      passwordHash.compareHash.mockImplementation((_password, hash) =>
        Promise.resolve(hash === newerStaffUser.password),
      );

      const response = await service.postSignIn({
        email: newerStaffUser.email,
        password: 'staff-password',
      });

      expect(response).toEqual(
        expect.objectContaining({
          id: newerStaffUser.id,
          accessToken: 'signed-jwt',
        }),
      );
      expect(passwordHash.compareHash).toHaveBeenCalledTimes(2);
      expect(passwordHash.compareHash).toHaveBeenNthCalledWith(
        1,
        'staff-password',
        olderUser.password,
      );
      expect(passwordHash.compareHash).toHaveBeenNthCalledWith(
        2,
        'staff-password',
        newerStaffUser.password,
      );
      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'success',
          userId: newerStaffUser.id,
        }),
      );
    });

    it('rejects a password matching neither of two same-email rows, trying both hashes', async () => {
      users.findAllByEmail.mockResolvedValue([olderUser, newerStaffUser]);
      passwordHash.compareHash.mockResolvedValue(false);

      const error = await rejectionOf(
        service.postSignIn({ email: olderUser.email, password: 'wrong' }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.getStatus()).toBe(401);
      expect(passwordHash.compareHash).toHaveBeenCalledTimes(2);
    });
  });

  describe('dual lookup (gym-foundation ADR-008)', () => {
    const activeStaff = {
      id: 'staff-1',
      name: 'Recepção',
      email: 'recepcao@example.com',
      passwordHash: 'staff-stored-hash',
      active: true,
      academiaId: 'academia-1',
    };

    it('resolves against AcademiaStaffMember when no Users row matches the email', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.findAllByEmail.mockResolvedValue([]);
      academiaStaff.findByEmail.mockResolvedValue(activeStaff);
      passwordHash.compareHash.mockResolvedValue(true);

      const response = await service.postSignIn({
        email: activeStaff.email,
        password: 'correct-password',
      });

      expect(response).toEqual(
        expect.objectContaining({
          id: activeStaff.id,
          productId: null,
          accessToken: 'signed-jwt',
        }),
      );
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: activeStaff.id, role: 'RECEPTIONIST' }),
      );
    });

    it('never attempts a staff lookup once a Users row has already matched', async () => {
      users.findByEmail.mockResolvedValue(activeUser);
      users.findAllByEmail.mockResolvedValue([activeUser]);
      passwordHash.compareHash.mockResolvedValue(true);

      await service.postSignIn({
        email: activeUser.email,
        password: 'correct-password',
      });

      expect(academiaStaff.findByEmail).not.toHaveBeenCalled();
    });

    it('rejects a staff account with no password set yet (not yet activated)', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.findAllByEmail.mockResolvedValue([]);
      academiaStaff.findByEmail.mockResolvedValue({
        ...activeStaff,
        passwordHash: null,
      });

      const error = await rejectionOf(
        service.postSignIn({
          email: activeStaff.email,
          password: 'anything',
        }),
      );

      expect(error.getStatus()).toBe(401);
    });

    it('rejects a removed (inactive) staff account even with the correct password', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.findAllByEmail.mockResolvedValue([]);
      academiaStaff.findByEmail.mockResolvedValue({
        ...activeStaff,
        active: false,
      });
      passwordHash.compareHash.mockResolvedValue(true);

      const error = await rejectionOf(
        service.postSignIn({
          email: activeStaff.email,
          password: 'correct-password',
        }),
      );

      expect(error.getStatus()).toBe(401);
      expect(error.message).toBe('Usuário não autorizado. Conta inativa.');
    });
  });

  it('UT-044 logs a structured password failure without the password', async () => {
    users.findAllByEmail.mockResolvedValue([activeUser]);
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
    users.findAllByEmail.mockResolvedValue([activeUser]);
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
