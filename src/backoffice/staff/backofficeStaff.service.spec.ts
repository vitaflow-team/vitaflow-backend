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
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  } as Users;
}

describe('BackofficeStaffService — platform-admin-access UT-016 through UT-022', () => {
  const users = {
    findStaffByEmail: jest.fn(),
    findAllBackofficeStaff: jest.fn(),
    countAdmins: jest.fn(),
    updateBackofficeTier: jest.fn(),
    setIsBackoffice: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    activateStaffWithTokenAndPassword: jest.fn(),
  };
  const viewAsSessions = { endAllOpenForStaff: jest.fn() };
  const userToken = { issue: jest.fn(), findLive: jest.fn() };
  const hash = { generateHash: jest.fn(), compareHash: jest.fn() };
  const mailService = { sendEmailPassword: jest.fn() };

  const service = new BackofficeStaffService(
    users as unknown as UserRepository,
    viewAsSessions as unknown as BackofficeViewAsSessionRepository,
    userToken as unknown as UserTokenService,
    hash as unknown as PasswordHash,
    mailService as unknown as MailService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    hash.generateHash.mockResolvedValue('hashed');
    userToken.issue.mockResolvedValue('raw-token');
  });

  describe('invite', () => {
    it('UT-016: creates a Users row (isBackoffice true, productId null, chosen tier), pending activation', async () => {
      users.findStaffByEmail.mockResolvedValue(null);
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

    it('UT-017: an existing customer account on the same email never blocks the invite (findStaffByEmail is scoped to staff rows only)', async () => {
      users.findStaffByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue(makeStaff());

      await expect(
        service.invite('cliente@example.com', BackofficeTier.EQUIPE, 'admin-1'),
      ).resolves.toBeUndefined();

      expect(users.create).toHaveBeenCalled();
    });

    it('UT-018: a second invite while the first is still pending (active: false) is a no-op, caller told it is already pending', async () => {
      users.findStaffByEmail.mockResolvedValue(makeStaff({ active: false }));

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
      users.findStaffByEmail.mockResolvedValue(makeStaff({ active: true }));

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
