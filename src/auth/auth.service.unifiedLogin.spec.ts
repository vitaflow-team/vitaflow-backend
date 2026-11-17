import { AuditLogger } from '@/auth/auditLogger.service';
import { CodedError } from '@/common/errors/codedError';
import { MailService } from '@/mail/mail.service';
import { AcademiaStaffMemberRepository } from '@/repositories/academia/academiaStaffMember.repository';
import { OAuthIdentityRepository } from '@/repositories/auth/oauthIdentity.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './googleAuth.service';

const JWT_SECRET = 'unified-login-unit-secret';
const verified = { sub: 'google-sub', email: 'Ana@X.com', name: 'Ana' };
const account = {
  id: 'user-1',
  name: 'Ana',
  email: 'ana@x.com',
  password: 'stored-hash',
  avatar: null,
  active: true,
  productId: 'free-1',
  product: null,
  isBackoffice: false,
};
const staffAccount = { ...account, id: 'staff-1', isBackoffice: true };
const identity = {
  id: 'identity-1',
  provider: 'google',
  providerAccountId: verified.sub,
  userId: account.id,
};

const googleAuth = { verify: jest.fn() };
const identities = {
  findByProviderAccount: jest.fn(),
  findByUserId: jest.fn(),
  create: jest.fn(),
};
const users = {
  findByEmail: jest.fn(),
  findByIdWithProduct: jest.fn(),
  findUnique: jest.fn(),
  create: jest.fn(),
  activateUser: jest.fn(),
  updatePassword: jest.fn(),
};
const passwordHash = { generateHash: jest.fn(), compareHash: jest.fn() };
const mailService = { sendEmailPassword: jest.fn() };
const auditLogger = { log: jest.fn(), warn: jest.fn() };
const products = { findFreeProduct: jest.fn() };
const userTokens = { deleteAll: jest.fn() };
const clients = { setAllClientUser: jest.fn() };
const receptionists = { findByEmail: jest.fn() };
// A real JwtService, so an intent is signed and verified for real.
const jwtService = new JwtService({ secret: JWT_SECRET });

const service = new AuthService(
  googleAuth as unknown as GoogleAuthService,
  identities as unknown as OAuthIdentityRepository,
  users as unknown as UserRepository,
  passwordHash as unknown as PasswordHash,
  jwtService,
  { getSignedUrl: jest.fn() } as unknown as UploadService,
  mailService as unknown as MailService,
  auditLogger as unknown as AuditLogger,
  products as unknown as ProductsRepository,
  userTokens as unknown as UserTokenRepository,
  clients as unknown as ClientsRepository,
  receptionists as unknown as AcademiaStaffMemberRepository,
);

function rejection(promise: Promise<unknown>): Promise<CodedError | AppError> {
  return promise.then(
    () => {
      throw new Error('Expected a rejection.');
    },
    (caught: unknown) => caught as CodedError | AppError,
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  process.env.JWT_SECRET = JWT_SECRET;
  googleAuth.verify.mockResolvedValue(verified);
  identities.findByProviderAccount.mockResolvedValue(null);
  identities.findByUserId.mockResolvedValue(null);
  identities.create.mockResolvedValue(identity);
  users.findByEmail.mockResolvedValue(null);
  users.findByIdWithProduct.mockResolvedValue(account);
  users.create.mockResolvedValue(account);
  passwordHash.generateHash.mockResolvedValue('random-hash');
  products.findFreeProduct.mockResolvedValue({ id: 'free-1' });
  receptionists.findByEmail.mockResolvedValue(null);
});

describe('AuthService — unified login account, Google resolution order', () => {
  it('UT-005: a linked identity signs in without ever looking the email up, staff included', async () => {
    identities.findByProviderAccount.mockResolvedValue({
      ...identity,
      userId: staffAccount.id,
    });
    users.findByIdWithProduct.mockResolvedValue(staffAccount);

    const response = await service.signInWithGoogle('id-token');

    expect(response.id).toBe(staffAccount.id);
    expect(users.findByEmail).not.toHaveBeenCalled();
    expect(receptionists.findByEmail).not.toHaveBeenCalled();
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'success', reason: 'signed_in' }),
    );
  });

  it('UT-006: an active ordinary account is linked, notified, and the receptionist lookup is skipped', async () => {
    users.findByEmail.mockResolvedValue(account);

    const response = await service.signInWithGoogle('id-token');

    expect(response.id).toBe(account.id);
    expect(users.findByEmail).toHaveBeenCalledWith('Ana@X.com');
    expect(identities.create).toHaveBeenCalledWith({
      provider: 'google',
      providerAccountId: verified.sub,
      userId: account.id,
    });
    expect(mailService.sendEmailPassword).toHaveBeenCalledTimes(1);
    expect(receptionists.findByEmail).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'success', reason: 'linked' }),
    );
  });

  it('UT-007: an inactive ordinary account loses its credentials, is activated and linked', async () => {
    users.findByEmail.mockResolvedValue({ ...account, active: false });

    await service.signInWithGoogle('id-token');

    expect(userTokens.deleteAll).toHaveBeenCalledWith({ userID: account.id });
    expect(users.updatePassword).toHaveBeenCalledWith(
      account.id,
      'random-hash',
    );
    expect(users.activateUser).toHaveBeenCalledWith(account.id);
    expect(identities.create).toHaveBeenCalledTimes(1);
    expect(clients.setAllClientUser).toHaveBeenCalledWith(
      account.id,
      account.email,
    );
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'success', reason: 'activated' }),
    );
  });

  it.each([
    ['an active staff account', true],
    ['an inactive staff account', false],
  ])(
    'UT-008: %s is refused with 403 google_link_required and left untouched',
    async (_label, active) => {
      users.findByEmail.mockResolvedValue({ ...staffAccount, active });

      const error = await rejection(service.signInWithGoogle('id-token'));

      expect(error).toBeInstanceOf(CodedError);
      expect(error.getStatus()).toBe(403);
      expect((error as CodedError).code).toBe('google_link_required');
      expect(identities.create).not.toHaveBeenCalled();
      expect(users.create).not.toHaveBeenCalled();
      expect(users.activateUser).not.toHaveBeenCalled();
      expect(users.updatePassword).not.toHaveBeenCalled();
      expect(userTokens.deleteAll).not.toHaveBeenCalled();
      expect(mailService.sendEmailPassword).not.toHaveBeenCalled();
    },
  );

  it('UT-008: the refusal is audited by its code, never by the email', async () => {
    users.findByEmail.mockResolvedValue(staffAccount);

    await rejection(service.signInWithGoogle('id-token'));

    expect(auditLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        reason: 'google_link_required',
      }),
    );
    expect(JSON.stringify(auditLogger.warn.mock.calls)).not.toContain('@');
  });

  it.each([
    ['an active receptionist', true],
    ['an inactive receptionist', false],
  ])(
    'UT-009: the email of %s is refused with 403 google_receptionist_email and no account is created',
    async (_label, active) => {
      receptionists.findByEmail.mockResolvedValue({ id: 'recep-1', active });

      const error = await rejection(service.signInWithGoogle('id-token'));

      expect(error.getStatus()).toBe(403);
      expect((error as CodedError).code).toBe('google_receptionist_email');
      expect(receptionists.findByEmail).toHaveBeenCalledWith('ana@x.com');
      expect(users.create).not.toHaveBeenCalled();
      expect(identities.create).not.toHaveBeenCalled();
    },
  );

  it('UT-010: an email with no account and no receptionist gets an account on the free product', async () => {
    const response = await service.signInWithGoogle('id-token');

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ana@x.com',
        active: true,
        product: { connect: { id: 'free-1' } },
      }),
    );
    expect(identities.create).toHaveBeenCalledTimes(1);
    expect(response.id).toBe(account.id);
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'success', reason: 'created' }),
    );
  });

  it('UT-011: an account linked to a different Google identity keeps the generic 401', async () => {
    users.findByEmail.mockResolvedValue(account);
    identities.findByUserId.mockResolvedValue({
      ...identity,
      providerAccountId: 'another-sub',
    });

    const error = await rejection(service.signInWithGoogle('id-token'));

    expect(error).toBeInstanceOf(AppError);
    expect(error.getStatus()).toBe(401);
    expect((error as AppError).reason).toBe('identity_conflict');
    expect(identities.create).not.toHaveBeenCalled();
  });

  it('UT-011: a Google token that fails verification propagates the generic 401', async () => {
    googleAuth.verify.mockRejectedValue(
      new AppError('Falha ao entrar com Google.', 401, 'email_not_verified'),
    );

    const error = await rejection(service.signInWithGoogle('id-token'));

    expect(error.getStatus()).toBe(401);
    expect(users.findByEmail).not.toHaveBeenCalled();
  });

  it('a concurrent first sign-in that lost the email race signs in as the account that won', async () => {
    users.create.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' }),
    );
    users.findByEmail.mockResolvedValueOnce(null).mockResolvedValue(account);
    identities.findByUserId.mockResolvedValue(identity);

    const response = await service.signInWithGoogle('id-token');

    expect(response.id).toBe(account.id);
  });
});

describe('AuthService — unified login account, connect Google', () => {
  const issue = (userId: string, password?: string) =>
    service.issueGoogleLinkIntent(userId, password);

  describe('issueGoogleLinkIntent', () => {
    it('UT-012: an ordinary account gets an intent without a password', async () => {
      users.findUnique.mockResolvedValue(account);

      const { intent } = await issue(account.id);

      expect(jwtService.decode(intent)).toMatchObject({
        purpose: 'google_link',
        id: account.id,
      });
      expect(passwordHash.compareHash).not.toHaveBeenCalled();
    });

    it.each([
      ['no password', undefined],
      ['a wrong password', 'errada'],
    ])(
      'UT-012: a staff account with %s is 401 invalid_password',
      async (_label, password) => {
        users.findUnique.mockResolvedValue(staffAccount);
        passwordHash.compareHash.mockResolvedValue(false);

        const error = await rejection(issue(staffAccount.id, password));

        expect(error.getStatus()).toBe(401);
        expect((error as CodedError).code).toBe('invalid_password');
      },
    );

    it('UT-012: a staff account with the right password gets an intent', async () => {
      users.findUnique.mockResolvedValue(staffAccount);
      passwordHash.compareHash.mockResolvedValue(true);

      const { intent } = await issue(staffAccount.id, 'SenhaAtual123');

      expect(passwordHash.compareHash).toHaveBeenCalledWith(
        'SenhaAtual123',
        'stored-hash',
      );
      expect(jwtService.decode(intent)).toMatchObject({ id: staffAccount.id });
    });

    it('UT-012: an account that already has a Google identity is 409 google_already_linked', async () => {
      users.findUnique.mockResolvedValue(account);
      identities.findByUserId.mockResolvedValue(identity);

      const error = await rejection(issue(account.id));

      expect(error.getStatus()).toBe(409);
      expect((error as CodedError).code).toBe('google_already_linked');
    });
  });

  describe('linkGoogle', () => {
    const link = async (userId = account.id, owner = account.id) => {
      users.findUnique.mockResolvedValue(account);
      const { intent } = await issue(owner);
      jest.clearAllMocks();
      return service.linkGoogle(userId, { idToken: 'id-token', intent });
    };

    it('UT-014: a valid intent and a matching Google email link the identity, audit and notify', async () => {
      const response = await link();

      expect(identities.create).toHaveBeenCalledWith({
        provider: 'google',
        providerAccountId: verified.sub,
        userId: account.id,
      });
      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'account_linked',
          source: 'settings',
          userId: account.id,
        }),
      );
      expect(mailService.sendEmailPassword).toHaveBeenCalledTimes(1);
      expect(response).toMatchObject({ id: account.id });
      expect(response.accessToken).toEqual(expect.any(String));
    });

    it('UT-014: a notification failure does not fail the link', async () => {
      mailService.sendEmailPassword.mockRejectedValue(new Error('smtp down'));

      await expect(link()).resolves.toMatchObject({ id: account.id });
    });

    it('UT-015: the Google email is compared ignoring case', async () => {
      // verified.email is 'Ana@X.com'; the account stores 'ana@x.com'.
      await expect(link()).resolves.toMatchObject({ id: account.id });
    });

    it('UT-015: a different Google email is 409 google_email_mismatch and links nothing', async () => {
      googleAuth.verify.mockResolvedValue({
        ...verified,
        email: 'other@x.com',
      });

      const error = await rejection(link());

      expect(error.getStatus()).toBe(409);
      expect((error as CodedError).code).toBe('google_email_mismatch');
      expect(identities.create).not.toHaveBeenCalled();
    });

    it('UT-016: an identity owned by another account is 409 google_identity_in_use', async () => {
      identities.findByProviderAccount.mockResolvedValue({
        ...identity,
        userId: 'someone-else',
      });

      const error = await rejection(link());

      expect(error.getStatus()).toBe(409);
      expect((error as CodedError).code).toBe('google_identity_in_use');
      expect(identities.create).not.toHaveBeenCalled();
    });

    it('UT-016: the same identity linked again succeeds without a second insert, audit or email', async () => {
      identities.findByProviderAccount.mockResolvedValue(identity);

      await expect(link()).resolves.toMatchObject({ id: account.id });

      expect(identities.create).not.toHaveBeenCalled();
      expect(auditLogger.log).not.toHaveBeenCalled();
      expect(mailService.sendEmailPassword).not.toHaveBeenCalled();
    });

    it('UT-017: an intent issued for another account is 401 invalid_intent before Google is consulted', async () => {
      const error = await rejection(link('intruder-1', account.id));

      expect(error.getStatus()).toBe(401);
      expect((error as CodedError).code).toBe('invalid_intent');
      expect(googleAuth.verify).not.toHaveBeenCalled();
      expect(identities.create).not.toHaveBeenCalled();
    });

    it('UT-017: a string that is not an intent is 401 invalid_intent', async () => {
      const error = await rejection(
        service.linkGoogle(account.id, {
          idToken: 'id-token',
          intent: 'x.y.z',
        }),
      );

      expect((error as CodedError).code).toBe('invalid_intent');
      expect(googleAuth.verify).not.toHaveBeenCalled();
    });

    it('UT-017: the identity is created for the authenticated account and no other', async () => {
      await link();

      expect(users.findByIdWithProduct).toHaveBeenCalledWith(account.id);
      expect(identities.create.mock.calls[0][0].userId).toBe(account.id);
      expect(users.findByEmail).not.toHaveBeenCalled();
    });
  });
});
