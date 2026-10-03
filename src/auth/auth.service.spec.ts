import { AuditLogger } from '@/auth/auditLogger.service';
import { MailService } from '@/mail/mail.service';
import { OAuthIdentityRepository } from '@/repositories/auth/oauthIdentity.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OAuthIdentity } from '@prisma/client';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './googleAuth.service';

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
    updatePassword: jest.Mock;
  };
  let passwordHash: { generateHash: jest.Mock };
  let jwtService: { signAsync: jest.Mock };
  let uploadService: { getSignedUrl: jest.Mock };
  let mailService: { sendEmailPassword: jest.Mock };
  let auditLogger: { log: jest.Mock; warn: jest.Mock };
  let products: { findFreeProduct: jest.Mock };
  let userTokens: { deleteAll: jest.Mock };
  let clients: { setAllClientUser: jest.Mock };
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
      updatePassword: jest.fn().mockResolvedValue(activeUser),
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
    userTokens = { deleteAll: jest.fn().mockResolvedValue(null) };
    clients = { setAllClientUser: jest.fn().mockResolvedValue(undefined) };
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
      userTokens as unknown as UserTokenRepository,
      clients as unknown as ClientsRepository,
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

  describe('Google activation of a pre-registered account', () => {
    const originalPlaintext = 'set-by-whoever-registered-first';

    // UT-008
    it('replaces the existing password with an unknown one and clears pending tokens', async () => {
      const bcrypt = new PasswordHash();
      const originalHash = await bcrypt.generateHash(originalPlaintext);
      passwordHash.generateHash.mockImplementation((payload: string) =>
        bcrypt.generateHash(payload),
      );
      users.findByEmailInsensitive.mockResolvedValue({
        ...activeUser,
        active: false,
        password: originalHash,
      });

      await service.signInWithGoogle('raw-id-token');

      expect(userTokens.deleteAll).toHaveBeenCalledWith({
        userID: activeUser.id,
      });
      expect(users.updatePassword).toHaveBeenCalledTimes(1);
      const [userId, storedHash] = users.updatePassword.mock.calls[0] as [
        string,
        string,
      ];
      expect(userId).toBe(activeUser.id);
      expect(storedHash).not.toBe(originalHash);
      expect(storedHash).toMatch(/^\$2[aby]\$/);
      await expect(
        bcrypt.compareHash(originalPlaintext, storedHash),
      ).resolves.toBe(false);
      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'password_invalidated',
          userId: activeUser.id,
        }),
      );
    });

    it('revokes the old credentials before the account becomes active', async () => {
      users.findByEmailInsensitive.mockResolvedValue({
        ...activeUser,
        active: false,
      });

      await service.signInWithGoogle('raw-id-token');

      const revokedAt = users.updatePassword.mock.invocationCallOrder[0];
      const activatedAt = users.activateUser.mock.invocationCallOrder[0];
      expect(revokedAt).toBeLessThan(activatedAt);
    });

    it('links client records registered under the email once activated', async () => {
      users.findByEmailInsensitive.mockResolvedValue({
        ...activeUser,
        active: false,
      });

      await service.signInWithGoogle('raw-id-token');

      expect(clients.setAllClientUser).toHaveBeenCalledWith(
        activeUser.id,
        activeUser.email,
      );
    });

    // UT-009
    it('writes no password for an account created through Google, first or later sign-in', async () => {
      await service.signInWithGoogle('raw-id-token');
      identities.findByProviderAccount.mockResolvedValue(identity);
      await service.signInWithGoogle('raw-id-token');

      expect(users.updatePassword).not.toHaveBeenCalled();
      expect(userTokens.deleteAll).not.toHaveBeenCalled();
    });

    it('skips the password write for an inactive account without a password', async () => {
      users.findByEmailInsensitive.mockResolvedValue({
        ...activeUser,
        active: false,
        password: '',
      });

      await expect(
        service.signInWithGoogle('raw-id-token'),
      ).resolves.toBeDefined();

      expect(userTokens.deleteAll).toHaveBeenCalledTimes(1);
      expect(users.updatePassword).not.toHaveBeenCalled();
    });

    it('never touches the password of an already active account', async () => {
      users.findByEmailInsensitive.mockResolvedValue(activeUser);

      await service.signInWithGoogle('raw-id-token');

      expect(users.updatePassword).not.toHaveBeenCalled();
      expect(userTokens.deleteAll).not.toHaveBeenCalled();
      expect(clients.setAllClientUser).not.toHaveBeenCalled();
    });
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

  describe('linking registered students on first Google account creation', () => {
    it('UT-096 links every record with the verified e-mail after the identity exists', async () => {
      const order: string[] = [];
      identities.create.mockImplementation(() => {
        order.push('identity');
        return Promise.resolve(undefined);
      });
      clients.setAllClientUser.mockImplementation(() => {
        order.push('link');
        return Promise.resolve(undefined);
      });
      users.findByEmailInsensitive.mockResolvedValue(null);
      users.create.mockResolvedValue(activeUser);
      users.findByIdWithProduct.mockResolvedValue(activeUser);

      await service.signInWithGoogle('raw-id-token');

      expect(clients.setAllClientUser).toHaveBeenCalledWith(
        activeUser.id,
        expect.stringMatching(/^[^A-Z]+$/),
      );
      expect(order).toEqual(['identity', 'link']);
    });

    it('UT-097 still signs in and logs google_link_failed when the link fails', async () => {
      users.findByEmailInsensitive.mockResolvedValue(null);
      users.create.mockResolvedValue(activeUser);
      users.findByIdWithProduct.mockResolvedValue(activeUser);
      clients.setAllClientUser.mockRejectedValue(new Error('db down'));
      const warned = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await expect(service.signInWithGoogle('raw-id-token')).resolves.toEqual(
        expect.objectContaining({ accessToken: 'issued-jwt' }),
      );

      expect(warned).toHaveBeenCalledWith(
        expect.stringContaining('google_link_failed'),
      );
      expect(JSON.stringify(warned.mock.calls)).not.toContain('db down');
      warned.mockRestore();
    });
  });

  // UT-013: branches that sat 3 levels deep (catch > if > if) before
  // createGoogleUser and createIdentity were flattened.
  const uniqueViolation = () =>
    Object.assign(new Error('unique'), { code: 'P2002' });

  describe('user creation conflict recovery after flattening', () => {
    const winnerUser = { ...activeUser, id: 'winner-1' };

    it('signs in as the provider identity winner when user creation collides', async () => {
      identities.findByProviderAccount
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ ...identity, userId: winnerUser.id });
      users.create.mockRejectedValue(uniqueViolation());
      users.findByIdWithProduct.mockResolvedValue(winnerUser);

      const response = await service.signInWithGoogle('raw-id-token');

      expect(response.id).toBe(winnerUser.id);
      expect(users.findByIdWithProduct).toHaveBeenCalledWith(winnerUser.id);
      expect(users.findByEmailInsensitive).toHaveBeenCalledTimes(1);
      expect(identities.create).not.toHaveBeenCalled();
    });

    it('falls back to the email-matched user when the winner has no user row', async () => {
      identities.findByProviderAccount
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ ...identity, userId: 'ghost-user' });
      identities.findByUserId.mockResolvedValue(identity);
      users.create.mockRejectedValue(uniqueViolation());
      users.findByIdWithProduct.mockResolvedValue(null);
      users.findByEmailInsensitive
        .mockResolvedValueOnce(null)
        .mockResolvedValue(activeUser);

      const response = await service.signInWithGoogle('raw-id-token');

      expect(response.id).toBe(activeUser.id);
      expect(users.findByEmailInsensitive).toHaveBeenCalledTimes(2);
      expect(identities.create).not.toHaveBeenCalled();
    });
  });

  describe('identity creation conflict recovery after flattening', () => {
    it('rejects with identity_conflict when the collided identity links another user', async () => {
      identities.findByProviderAccount
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ ...identity, userId: 'other-user' });
      identities.create.mockRejectedValue(uniqueViolation());

      await expect(
        service.signInWithGoogle('raw-id-token'),
      ).rejects.toMatchObject({ reason: 'identity_conflict' });
      expect(mailService.sendEmailPassword).not.toHaveBeenCalled();
    });

    it('signs in without relinking when the collided identity already links this user', async () => {
      identities.findByProviderAccount
        .mockResolvedValueOnce(null)
        .mockResolvedValue(identity);
      identities.create.mockRejectedValue(uniqueViolation());

      const response = await service.signInWithGoogle('raw-id-token');

      expect(response.id).toBe(activeUser.id);
      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'success', reason: 'signed_in' }),
      );
      expect(mailService.sendEmailPassword).not.toHaveBeenCalled();
    });
  });
});
