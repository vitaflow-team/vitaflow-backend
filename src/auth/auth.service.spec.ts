import { AuditLogger } from '@/auth/audit-logger.service';
import { MailService } from '@/mail/mail.service';
import { OAuthIdentityRepository } from '@/repositories/auth/oauthIdentity.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OAuthIdentity } from '@prisma/client';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './google-auth.service';

describe('AuthService.signInWithGoogle', () => {
  const verified = {
    sub: 'google-sub',
    email: 'User@Example.com',
    name: 'User Name',
    picture: 'https://example.com/avatar.png',
  };
  const activeUser = {
    id: 'user-1',
    name: 'User Name',
    email: 'user@example.com',
    password: 'password-hash',
    avatar: null,
    active: true,
    phone: null,
    birthDate: null,
    productId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    product: null,
  };
  const identity = {
    id: 'identity-1',
    provider: 'google',
    providerAccountId: verified.sub,
    userId: activeUser.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  } satisfies OAuthIdentity;

  const freeProduct = {
    id: 'free-1',
    name: 'Gratuito',
    price: 0,
    type: 'USER' as const,
    groupId: 'group-1',
    stripeId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let googleAuth: { verify: jest.Mock };
  let identities: {
    findByProviderAccount: jest.Mock;
    findByUserId: jest.Mock;
    create: jest.Mock;
  };
  let users: {
    findByEmailInsensitive: jest.Mock;
    findByIdWithProduct: jest.Mock;
    create: jest.Mock;
    activateUser: jest.Mock;
  };
  let passwordHash: { generateHash: jest.Mock };
  let jwtService: { signAsync: jest.Mock };
  let uploadService: { getSignedUrl: jest.Mock };
  let mailService: { sendEmailPassword: jest.Mock };
  let auditLogger: { log: jest.Mock; warn: jest.Mock };
  let products: { findFreeProduct: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    googleAuth = { verify: jest.fn().mockResolvedValue(verified) };
    identities = {
      findByProviderAccount: jest.fn().mockResolvedValue(null),
      findByUserId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(identity),
    };
    users = {
      findByEmailInsensitive: jest.fn().mockResolvedValue(null),
      findByIdWithProduct: jest.fn().mockResolvedValue(activeUser),
      create: jest.fn().mockResolvedValue(activeUser),
      activateUser: jest.fn().mockResolvedValue(activeUser),
    };
    passwordHash = { generateHash: jest.fn().mockResolvedValue('random-hash') };
    jwtService = { signAsync: jest.fn().mockResolvedValue('issued-jwt') };
    uploadService = {
      getSignedUrl: jest.fn().mockResolvedValue('signed-avatar'),
    };
    mailService = { sendEmailPassword: jest.fn().mockResolvedValue(undefined) };
    auditLogger = { log: jest.fn(), warn: jest.fn() };
    products = {
      findFreeProduct: jest.fn().mockResolvedValue(freeProduct),
    };
    service = new AuthService(
      googleAuth as unknown as GoogleAuthService,
      identities as unknown as OAuthIdentityRepository,
      users as unknown as UserRepository,
      passwordHash as unknown as PasswordHash,
      jwtService as unknown as JwtService,
      uploadService as unknown as UploadService,
      mailService as unknown as MailService,
      auditLogger as unknown as AuditLogger,
      products as unknown as ProductsRepository,
    );
  });

  it('UT-010 creates an active user and identity and returns SignInResponse', async () => {
    const result = await service.signInWithGoogle('raw-id-token');

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'user@example.com',
        active: true,
        password: 'random-hash',
      }),
    );
    expect(identities.create).toHaveBeenCalledWith({
      provider: 'google',
      providerAccountId: verified.sub,
      userId: activeUser.id,
    });
    expect(result).toEqual(
      expect.objectContaining({ id: activeUser.id, accessToken: 'issued-jwt' }),
    );
  });

  it('UT-011 falls back to the email local part when Google supplies no name', async () => {
    googleAuth.verify.mockResolvedValue({ ...verified, name: undefined });

    await service.signInWithGoogle('raw-id-token');

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'user' }),
    );
  });

  it('UT-012 activates and links a matching inactive user', async () => {
    const inactive = { ...activeUser, active: false };
    users.findByEmailInsensitive.mockResolvedValue(inactive);
    users.findByIdWithProduct.mockResolvedValue(activeUser);

    const result = await service.signInWithGoogle('raw-id-token');

    expect(users.activateUser).toHaveBeenCalledWith(activeUser.id);
    expect(identities.create).toHaveBeenCalledTimes(1);
    expect(mailService.sendEmailPassword).not.toHaveBeenCalled();
    expect(result.accessToken).toBe('issued-jwt');
  });

  it('UT-013 links an active user, notifies exactly once, and signs in', async () => {
    users.findByEmailInsensitive.mockResolvedValue(activeUser);

    const result = await service.signInWithGoogle('raw-id-token');

    expect(identities.create).toHaveBeenCalledTimes(1);
    expect(mailService.sendEmailPassword).toHaveBeenCalledTimes(1);
    expect(result.accessToken).toBe('issued-jwt');
  });

  it('UT-014 signs in an already linked identity without creating or mailing', async () => {
    identities.findByProviderAccount.mockResolvedValue(identity);

    const result = await service.signInWithGoogle('raw-id-token');

    expect(result.id).toBe(activeUser.id);
    expect(identities.create).not.toHaveBeenCalled();
    expect(mailService.sendEmailPassword).not.toHaveBeenCalled();
  });

  it('UT-015 gives provider identity priority over a different email-matched user', async () => {
    identities.findByProviderAccount.mockResolvedValue(identity);

    const result = await service.signInWithGoogle('raw-id-token');

    expect(result.id).toBe(activeUser.id);
    expect(users.findByEmailInsensitive).not.toHaveBeenCalled();
  });

  it('UT-016 rejects a user already linked to a different Google sub', async () => {
    users.findByEmailInsensitive.mockResolvedValue(activeUser);
    identities.findByUserId.mockResolvedValue({
      ...identity,
      providerAccountId: 'different-sub',
    });

    await expect(
      service.signInWithGoogle('raw-id-token'),
    ).rejects.toBeInstanceOf(AppError);
    expect(identities.create).not.toHaveBeenCalled();
    expect(mailService.sendEmailPassword).not.toHaveBeenCalled();
  });

  it('UT-017 recovers a concurrent first-create unique conflict as an existing link', async () => {
    let storedIdentity: OAuthIdentity | null = null;
    let createCalls = 0;
    identities.findByProviderAccount.mockImplementation(() =>
      Promise.resolve(storedIdentity),
    );
    users.create.mockImplementation(() => {
      createCalls += 1;
      if (createCalls === 2) {
        return Promise.reject(
          Object.assign(new Error('unique'), { code: 'P2002' }),
        );
      }
      return Promise.resolve(activeUser);
    });
    identities.create.mockImplementation(() => {
      storedIdentity = identity;
      return Promise.resolve(identity);
    });

    const results = await Promise.all([
      service.signInWithGoogle('raw-id-token'),
      service.signInWithGoogle('raw-id-token'),
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.id === activeUser.id)).toBe(true);
    expect(identities.create).toHaveBeenCalledTimes(1);
  });

  it('UT-018 performs no persistence or mail work when verification fails', async () => {
    googleAuth.verify.mockRejectedValue(new AppError('invalid', 401));

    await expect(
      service.signInWithGoogle('raw-id-token'),
    ).rejects.toBeInstanceOf(AppError);
    expect(users.create).not.toHaveBeenCalled();
    expect(identities.create).not.toHaveBeenCalled();
    expect(mailService.sendEmailPassword).not.toHaveBeenCalled();
  });

  it('UT-019 emits a distinct account_linked audit event for first linking', async () => {
    users.findByEmailInsensitive.mockResolvedValue(activeUser);

    await service.signInWithGoogle('raw-id-token');

    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'account_linked',
        userId: activeUser.id,
      }),
    );
  });

  it.each([
    ['created', null, activeUser],
    ['activated', { ...activeUser, active: false }, activeUser],
  ])(
    'UT-020 emits no account_linked event for %s outcome',
    async (_case, matched, loaded) => {
      users.findByEmailInsensitive.mockResolvedValue(matched);
      users.findByIdWithProduct.mockResolvedValue(loaded);

      await service.signInWithGoogle('raw-id-token');

      expect(auditLogger.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'account_linked' }),
      );
    },
  );

  it('UT-021 returns a valid response when notification mail fails', async () => {
    users.findByEmailInsensitive.mockResolvedValue(activeUser);
    mailService.sendEmailPassword.mockRejectedValue(new Error('mailer down'));

    await expect(service.signInWithGoogle('raw-id-token')).resolves.toEqual(
      expect.objectContaining({ accessToken: 'issued-jwt' }),
    );
  });

  it('UT-022 returns a valid response when audit logging throws', async () => {
    auditLogger.log.mockImplementation(() => {
      throw new Error('logger down');
    });
    auditLogger.warn.mockImplementation(() => {
      throw new Error('logger down');
    });

    await expect(service.signInWithGoogle('raw-id-token')).resolves.toEqual(
      expect.objectContaining({ accessToken: 'issued-jwt' }),
    );
  });

  it('UT-045 never includes the raw ID token or issued JWT in success or failure audit lines', async () => {
    const rawToken = 'highly-secret-google-id-token';
    await service.signInWithGoogle(rawToken);
    googleAuth.verify.mockRejectedValue(new AppError('invalid', 401));
    await expect(service.signInWithGoogle(rawToken)).rejects.toBeInstanceOf(
      AppError,
    );

    const serialized = JSON.stringify([
      ...auditLogger.log.mock.calls,
      ...auditLogger.warn.mock.calls,
    ]);
    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toContain('issued-jwt');
  });

  describe('free plan on Google creation', () => {
    // UT-005
    it('connects the free product before reading the created user back', async () => {
      const order: string[] = [];
      users.create.mockImplementation(() => {
        order.push('create');
        return Promise.resolve(activeUser);
      });
      users.findByIdWithProduct.mockImplementation(() => {
        order.push('findByIdWithProduct');
        return Promise.resolve(activeUser);
      });

      await service.signInWithGoogle('raw-id-token');

      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          product: { connect: { id: 'free-1' } },
        }),
      );
      expect(order).toEqual(['create', 'findByIdWithProduct']);
    });

    // UT-006
    it('fails with an AppError and creates no user when Gratuito is missing', async () => {
      products.findFreeProduct.mockResolvedValue(null);
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(
        service.signInWithGoogle('raw-id-token'),
      ).rejects.toBeInstanceOf(AppError);

      expect(users.create).not.toHaveBeenCalled();
      expect(identities.create).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalled();
      logged.mockRestore();
    });
  });
});
