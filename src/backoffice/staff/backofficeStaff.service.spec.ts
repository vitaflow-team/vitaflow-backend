import { AuditLogger } from '@/auth/auditLogger.service';
import { BackofficeViewAsSessionRepository } from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenService } from '@/users/token/userToken.service';
import { MailService } from '@/mail/mail.service';
import { PasswordHash } from '@/utils/password.hash';
import { BackofficeTier, Users } from '@prisma/client';
import { BackofficeStaffService } from './backofficeStaff.service';

function makeStaff(overrides: Partial<Users> = {}): Users {
  const timestamp = new Date('2026-10-15T09:00:00.000Z');
  return {
    id: 'staff-1',
    name: 'equipe',
    email: 'equipe@vitaflow.com',
    password: 'hash',
    avatar: null,
    active: true,
    phone: null,
    birthDate: null,
    productId: null,
    academiaId: null,
    termsAcceptedAt: null,
    healthDataConsentAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    subscriptionCancelAt: null,
    subscriptionCurrentPeriodEnd: null,
    isBackoffice: true,
    backofficeTier: BackofficeTier.EQUIPE,
    pendingBackofficeTier: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  } as Users;
}

const users = {
  findByEmail: jest.fn(),
  findAllBackofficeStaff: jest.fn(),
  countAdmins: jest.fn(),
  updateBackofficeTier: jest.fn(),
  setIsBackoffice: jest.fn(),
  findUnique: jest.fn(),
  create: jest.fn(),
  activateStaffWithTokenAndPassword: jest.fn(),
  setPendingBackofficeTier: jest.fn(),
  acceptBackofficeInvitation: jest.fn(),
  getUserProfile: jest.fn(),
};
const viewAsSessions = { endAllOpenForStaff: jest.fn() };
const userToken = {
  issue: jest.fn(),
  findLive: jest.fn(),
  revoke: jest.fn(),
};
const hash = { generateHash: jest.fn(), compareHash: jest.fn() };
const mailService = {
  sendEmailPassword: jest.fn(),
  sendNotificationEmail: jest.fn(),
};
const audit = { log: jest.fn(), warn: jest.fn() };

const service = new BackofficeStaffService(
  users as unknown as UserRepository,
  viewAsSessions as unknown as BackofficeViewAsSessionRepository,
  userToken as unknown as UserTokenService,
  hash as unknown as PasswordHash,
  mailService as unknown as MailService,
  audit as unknown as AuditLogger,
);

beforeEach(() => {
  jest.resetAllMocks();
  hash.generateHash.mockResolvedValue('hashed');
  userToken.issue.mockResolvedValue('raw-token');
});

describe('BackofficeStaffService — platform-admin-access UT-016 through UT-022', () => {
  describe('invite', () => {
    it('UT-016: creates a Users row (isBackoffice true, productId null, chosen tier), pending activation', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue(
        makeStaff({ id: 'new-staff', email: 'nova@vitaflow.com' }),
      );

      await service.invite(
        'nova@vitaflow.com',
        BackofficeTier.ADMIN,
        'admin-1',
      );

      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'nova@vitaflow.com',
          isBackoffice: true,
          backofficeTier: BackofficeTier.ADMIN,
          active: false,
        }),
      );
      expect(users.create.mock.calls[0][0]).not.toHaveProperty('productId');
      expect(userToken.issue).toHaveBeenCalledWith('new-staff', 'ACTIVATION');
      expect(mailService.sendEmailPassword).toHaveBeenCalled();
    });

    // Rewritten by unified-login-account (ADR-001): an existing customer
    // account still never blocks the invite, but it no longer receives a
    // second row — the invitation waits on that same account.
    it('UT-017: an existing customer account on the same email never blocks the invite, and no second row is created for it', async () => {
      users.findByEmail.mockResolvedValue(
        makeStaff({ id: 'customer-1', isBackoffice: false }),
      );

      await expect(
        service.invite('cliente@example.com', BackofficeTier.EQUIPE, 'admin-1'),
      ).resolves.toBeUndefined();

      expect(users.create).not.toHaveBeenCalled();
      expect(users.setPendingBackofficeTier).toHaveBeenCalledWith(
        'customer-1',
        BackofficeTier.EQUIPE,
      );
    });

    it('UT-018: a second invite while the first is still pending (active: false) is a no-op, caller told it is already pending', async () => {
      users.findByEmail.mockResolvedValue(makeStaff({ active: false }));

      await expect(
        service.invite(
          'pendente@vitaflow.com',
          BackofficeTier.EQUIPE,
          'admin-1',
        ),
      ).rejects.toMatchObject({ code: 'invitation_pending' });
      expect(users.create).not.toHaveBeenCalled();
    });

    it('inviting an email that already belongs to an active staff member is rejected distinctly', async () => {
      users.findByEmail.mockResolvedValue(makeStaff({ active: true }));

      await expect(
        service.invite('ativo@vitaflow.com', BackofficeTier.EQUIPE, 'admin-1'),
      ).rejects.toMatchObject({ code: 'already_staff' });
      expect(users.create).not.toHaveBeenCalled();
    });
  });

  describe('changeTier', () => {
    it('UT-019: takes effect immediately — a demotion from ADMIN to EQUIPE succeeds when another admin remains', async () => {
      users.findUnique.mockResolvedValue(
        makeStaff({ backofficeTier: BackofficeTier.ADMIN }),
      );
      users.countAdmins.mockResolvedValue(2);

      await service.changeTier('staff-1', BackofficeTier.EQUIPE);

      expect(users.updateBackofficeTier).toHaveBeenCalledWith(
        'staff-1',
        BackofficeTier.EQUIPE,
      );
    });

    it('UT-020: demoting the sole remaining ADMIN is rejected, tier unchanged', async () => {
      users.findUnique.mockResolvedValue(
        makeStaff({ backofficeTier: BackofficeTier.ADMIN }),
      );
      users.countAdmins.mockResolvedValue(1);

      await expect(
        service.changeTier('staff-1', BackofficeTier.EQUIPE),
      ).rejects.toMatchObject({ code: 'last_admin_required' });
      expect(users.updateBackofficeTier).not.toHaveBeenCalled();
    });

    it('promoting EQUIPE to ADMIN never checks the last-admin invariant', async () => {
      users.findUnique.mockResolvedValue(
        makeStaff({ backofficeTier: BackofficeTier.EQUIPE }),
      );

      await service.changeTier('staff-1', BackofficeTier.ADMIN);

      expect(users.countAdmins).not.toHaveBeenCalled();
      expect(users.updateBackofficeTier).toHaveBeenCalledWith(
        'staff-1',
        BackofficeTier.ADMIN,
      );
    });
  });

  describe('remove', () => {
    it('UT-021: removing the sole remaining ADMIN is rejected, same invariant as changeTier', async () => {
      users.findUnique.mockResolvedValue(
        makeStaff({ backofficeTier: BackofficeTier.ADMIN }),
      );
      users.countAdmins.mockResolvedValue(1);

      await expect(service.remove('staff-1')).rejects.toMatchObject({
        code: 'last_admin_required',
      });
      expect(users.setIsBackoffice).not.toHaveBeenCalled();
    });

    it('UT-022: sets isBackoffice false and ends every open view-as session for that staff member', async () => {
      users.findUnique.mockResolvedValue(
        makeStaff({ backofficeTier: BackofficeTier.EQUIPE }),
      );

      await service.remove('staff-1');

      expect(users.setIsBackoffice).toHaveBeenCalledWith('staff-1', false);
      expect(viewAsSessions.endAllOpenForStaff).toHaveBeenCalledWith('staff-1');
    });

    it('rejects a target that is not a current staff member', async () => {
      users.findUnique.mockResolvedValue(makeStaff({ isBackoffice: false }));

      await expect(service.remove('staff-1')).rejects.toMatchObject({
        code: 'staff_not_found',
      });
    });
  });

  describe('activate', () => {
    it('sets the real password and activates the account with a live token', async () => {
      userToken.findLive.mockResolvedValue({
        id: 'token-1',
        userID: 'staff-1',
      });
      users.activateStaffWithTokenAndPassword.mockResolvedValue(makeStaff());

      await service.activate('raw-token', 'NovaSenha123');

      expect(users.activateStaffWithTokenAndPassword).toHaveBeenCalledWith(
        { id: 'token-1', userID: 'staff-1' },
        'hashed',
      );
    });

    it('rejects an invalid or expired token', async () => {
      userToken.findLive.mockResolvedValue(null);

      await expect(
        service.activate('bad-token', 'NovaSenha123'),
      ).rejects.toMatchObject({ code: 'invalid_token' });
    });
  });
});

describe('BackofficeStaffService — unified login account UT-019 through UT-026', () => {
  const liveToken = { id: 'token-1', userID: 'customer-1' };
  const customer = (overrides: Partial<Users> = {}) =>
    makeStaff({
      id: 'customer-1',
      email: 'cliente@example.com',
      isBackoffice: false,
      backofficeTier: null,
      productId: 'product-1',
      ...overrides,
    });
  const invited = (overrides: Partial<Users> = {}) =>
    customer({ pendingBackofficeTier: BackofficeTier.EQUIPE, ...overrides });

  describe('invite', () => {
    it('UT-019: an email with no account gets the inactive staff row and the activation link, as before', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue(
        makeStaff({ id: 'new-staff', email: 'nova@vitaflow.com' }),
      );

      await service.invite('nova@vitaflow.com', BackofficeTier.EQUIPE, 'adm');

      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ isBackoffice: true, active: false }),
      );
      expect(userToken.issue).toHaveBeenCalledWith('new-staff', 'ACTIVATION');
      expect(mailService.sendEmailPassword.mock.calls[0][4]).toContain(
        '/signin/activate-backoffice-staff?token=raw-token',
      );
      expect(users.setPendingBackofficeTier).not.toHaveBeenCalled();
    });

    it('UT-020: an ordinary account gets a pending tier, an invitation token and the acceptance link — never a new row', async () => {
      users.findByEmail.mockResolvedValue(customer());

      await service.invite('cliente@example.com', BackofficeTier.ADMIN, 'adm');

      expect(users.setPendingBackofficeTier).toHaveBeenCalledWith(
        'customer-1',
        BackofficeTier.ADMIN,
      );
      expect(userToken.issue).toHaveBeenCalledWith(
        'customer-1',
        'BACKOFFICE_INVITATION',
      );
      expect(mailService.sendNotificationEmail.mock.calls[0][4]).toContain(
        '/signin/accept-backoffice-staff?token=raw-token',
      );
      expect(users.create).not.toHaveBeenCalled();
    });

    it('UT-020: a mail failure propagates and grants nothing', async () => {
      users.findByEmail.mockResolvedValue(customer());
      mailService.sendNotificationEmail.mockRejectedValueOnce(
        new Error('smtp down'),
      );

      await expect(
        service.invite('cliente@example.com', BackofficeTier.ADMIN, 'adm'),
      ).rejects.toThrow('smtp down');

      expect(users.setIsBackoffice).not.toHaveBeenCalled();
      expect(users.acceptBackofficeInvitation).not.toHaveBeenCalled();
    });

    it.each([
      ['an active staff account', makeStaff({ active: true }), 'already_staff'],
      [
        'an inactive staff row',
        makeStaff({ active: false }),
        'invitation_pending',
      ],
      ['an account with a pending tier', invited(), 'invitation_pending'],
    ])('UT-021: %s is refused with 409', async (_label, account, code) => {
      users.findByEmail.mockResolvedValue(account);

      await expect(
        service.invite(account.email, BackofficeTier.EQUIPE, 'adm'),
      ).rejects.toMatchObject({ code, status: 409 });

      expect(users.setPendingBackofficeTier).not.toHaveBeenCalled();
      expect(users.create).not.toHaveBeenCalled();
      expect(userToken.issue).not.toHaveBeenCalled();
    });
  });

  describe('previewInvitation', () => {
    it('UT-022: a live token previews the tier and whether Google is linked', async () => {
      userToken.findLive.mockResolvedValue(liveToken);
      users.getUserProfile.mockResolvedValue({
        ...invited({ pendingBackofficeTier: BackofficeTier.ADMIN }),
        oAuthIdentity: { id: 'identity-1' },
      });

      await expect(service.previewInvitation('raw-token')).resolves.toEqual({
        tier: BackofficeTier.ADMIN,
        googleLinked: true,
      });
      expect(userToken.findLive).toHaveBeenCalledWith(
        'raw-token',
        'BACKOFFICE_INVITATION',
      );
    });

    it('UT-022: an unknown, expired or wrong-type token previews as 400 invalid_token', async () => {
      userToken.findLive.mockResolvedValue(null);

      await expect(service.previewInvitation('nope')).rejects.toMatchObject({
        code: 'invalid_token',
        status: 400,
      });
      expect(users.getUserProfile).not.toHaveBeenCalled();
    });
  });

  describe('accept', () => {
    it('UT-023: the correct password grants access and records the audit event with ids only', async () => {
      userToken.findLive.mockResolvedValue(liveToken);
      users.findUnique.mockResolvedValue(invited());
      hash.compareHash.mockResolvedValue(true);
      users.acceptBackofficeInvitation.mockResolvedValue(
        invited({ isBackoffice: true, backofficeTier: BackofficeTier.EQUIPE }),
      );

      await service.accept('raw-token', 'MinhaSenha123');

      expect(hash.compareHash).toHaveBeenCalledWith('MinhaSenha123', 'hash');
      expect(users.acceptBackofficeInvitation).toHaveBeenCalledWith(liveToken);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'staff_invitation_accepted',
          userId: 'customer-1',
        }),
      );
      expect(JSON.stringify(audit.log.mock.calls)).not.toContain('@');
    });

    it('UT-023: a wrong password is 401 invalid_password and the token is not consumed', async () => {
      userToken.findLive.mockResolvedValue(liveToken);
      users.findUnique.mockResolvedValue(invited());
      hash.compareHash.mockResolvedValue(false);

      await expect(service.accept('raw-token', 'errada')).rejects.toMatchObject(
        { code: 'invalid_password', status: 401 },
      );
      expect(users.acceptBackofficeInvitation).not.toHaveBeenCalled();
    });

    it('UT-023: an inactive account is 409 account_inactive before the password is checked', async () => {
      userToken.findLive.mockResolvedValue(liveToken);
      users.findUnique.mockResolvedValue(invited({ active: false }));

      await expect(service.accept('raw-token', 'x')).rejects.toMatchObject({
        code: 'account_inactive',
        status: 409,
      });
      expect(hash.compareHash).not.toHaveBeenCalled();
      expect(users.acceptBackofficeInvitation).not.toHaveBeenCalled();
    });

    it.each([
      ['no live token', null, invited()],
      ['an account that no longer exists', liveToken, null],
      ['a withdrawn invitation', liveToken, customer()],
    ])('UT-023: %s is 400 invalid_token', async (_label, token, account) => {
      userToken.findLive.mockResolvedValue(token);
      users.findUnique.mockResolvedValue(account);

      await expect(service.accept('raw-token', 'x')).rejects.toMatchObject({
        code: 'invalid_token',
        status: 400,
      });
      expect(users.acceptBackofficeInvitation).not.toHaveBeenCalled();
    });

    it('UT-023: a token consumed by a concurrent acceptance is 400 invalid_token', async () => {
      userToken.findLive.mockResolvedValue(liveToken);
      users.findUnique.mockResolvedValue(invited());
      hash.compareHash.mockResolvedValue(true);
      users.acceptBackofficeInvitation.mockResolvedValue(null);

      await expect(service.accept('raw-token', 'x')).rejects.toMatchObject({
        code: 'invalid_token',
      });
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('resend', () => {
    it('UT-024: a pending existing-account invitation is re-sent with a new invitation token', async () => {
      users.findUnique.mockResolvedValue(invited());

      await service.resend('customer-1');

      expect(userToken.issue).toHaveBeenCalledWith(
        'customer-1',
        'BACKOFFICE_INVITATION',
      );
      expect(mailService.sendNotificationEmail).toHaveBeenCalled();
    });

    it('UT-024: a pending new-account row is re-sent with a new activation token', async () => {
      users.findUnique.mockResolvedValue(makeStaff({ active: false }));

      await service.resend('staff-1');

      expect(userToken.issue).toHaveBeenCalledWith('staff-1', 'ACTIVATION');
      expect(mailService.sendEmailPassword).toHaveBeenCalled();
    });

    it.each([
      ['an active staff member', makeStaff({ active: true })],
      ['an ordinary account without an invitation', customer()],
    ])('UT-024: %s is 409 not_pending', async (_label, target) => {
      users.findUnique.mockResolvedValue(target);

      await expect(service.resend(target.id)).rejects.toMatchObject({
        code: 'not_pending',
        status: 409,
      });
      expect(userToken.issue).not.toHaveBeenCalled();
    });

    it('UT-024: an unknown id is 404 staff_not_found', async () => {
      users.findUnique.mockResolvedValue(null);

      await expect(service.resend('ghost')).rejects.toMatchObject({
        code: 'staff_not_found',
        status: 404,
      });
    });
  });

  describe('remove', () => {
    it('UT-025: removing a pending-only account clears the pending tier and revokes its invitation token', async () => {
      users.findUnique.mockResolvedValue(invited());

      await service.remove('customer-1');

      expect(users.setPendingBackofficeTier).toHaveBeenCalledWith(
        'customer-1',
        null,
      );
      expect(userToken.revoke).toHaveBeenCalledWith(
        'customer-1',
        'BACKOFFICE_INVITATION',
      );
      expect(users.setIsBackoffice).not.toHaveBeenCalled();
    });

    it('UT-025: removing a staff member withdraws access and ends open view-as sessions', async () => {
      users.findUnique.mockResolvedValue(makeStaff());

      await service.remove('staff-1');

      expect(users.setIsBackoffice).toHaveBeenCalledWith('staff-1', false);
      expect(viewAsSessions.endAllOpenForStaff).toHaveBeenCalledWith('staff-1');
      expect(userToken.revoke).not.toHaveBeenCalled();
    });

    it('UT-025: removing the last admin is 409 last_admin_required', async () => {
      users.findUnique.mockResolvedValue(
        makeStaff({ backofficeTier: BackofficeTier.ADMIN }),
      );
      users.countAdmins.mockResolvedValue(1);

      await expect(service.remove('staff-1')).rejects.toMatchObject({
        code: 'last_admin_required',
        status: 409,
      });
      expect(users.setIsBackoffice).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('UT-026: marks a pending existing-account invitation with the offered tier, and a staff row by its activation', async () => {
      users.findAllBackofficeStaff.mockResolvedValue([
        invited({ pendingBackofficeTier: BackofficeTier.ADMIN }),
        makeStaff({ id: 'active-staff', active: true }),
        makeStaff({ id: 'invited-staff', active: false }),
      ]);

      const list = await service.list();

      expect(list[0]).toMatchObject({
        id: 'customer-1',
        pending: true,
        tier: BackofficeTier.ADMIN,
      });
      expect(list[1]).toMatchObject({ id: 'active-staff', pending: false });
      expect(list[2]).toMatchObject({ id: 'invited-staff', pending: true });
    });
  });
});
