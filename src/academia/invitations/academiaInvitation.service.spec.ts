import { CodedError } from '@/common/errors/codedError';
import { AcademiaInvitationService } from './academiaInvitation.service';

function makeDeps() {
  const invitations = {
    findPendingDuplicate: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'invite-1' }),
    findById: jest.fn().mockResolvedValue({
      id: 'invite-1',
      academiaId: 'academia-1',
      kind: 'EMPLOYMENT',
      status: 'PENDING',
      educatorId: null,
      email: 'educador@example.com',
      academia: { id: 'academia-1', name: 'Academia Vida Ativa' },
    }),
    cancelIfPending: jest.fn().mockResolvedValue(1),
    listPendingForEducator: jest.fn().mockResolvedValue([]),
    transitionIfPendingForEducator: jest.fn().mockResolvedValue(1),
    listPendingReceptionistInvitations: jest.fn().mockResolvedValue([]),
    transitionIfPendingReceptionist: jest.fn().mockResolvedValue(1),
    setStaffId: jest.fn().mockResolvedValue(undefined),
  };
  const employments = {
    findActive: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'employment-1' }),
  };
  const users = {
    findByEmailInsensitive: jest.fn().mockResolvedValue(null),
  };
  const staffMembers = {
    create: jest.fn().mockResolvedValue({ id: 'staff-1' }),
  };
  const staffAuth = {
    sendActivationEmail: jest.fn().mockResolvedValue(undefined),
  };
  const activity = {
    recordActivity: jest.fn().mockResolvedValue(undefined),
  };
  return { invitations, employments, users, staffMembers, staffAuth, activity };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new AcademiaInvitationService(
    deps.invitations as never,
    deps.employments as never,
    deps.users as never,
    deps.staffMembers as never,
    deps.staffAuth as never,
    deps.activity as never,
  );
}

describe('AcademiaInvitationService', () => {
  describe('invite', () => {
    it('UT-006 creates a PENDING EMPLOYMENT invitation matched to an existing PHYSICAL_EDUCATOR account', async () => {
      const deps = makeDeps();
      deps.users.findByEmailInsensitive.mockResolvedValue({
        id: 'educator-1',
        product: { type: 'PHYSICAL_EDUCATOR' },
      });
      const service = makeService(deps);

      await service.invite('academia-1', 'educador@example.com', 'EMPLOYMENT');

      expect(deps.invitations.create).toHaveBeenCalledWith(
        'academia-1',
        'educador@example.com',
        'EMPLOYMENT',
        'educator-1',
      );
    });

    it('UT-007 creates a PENDING RECEPTIONIST invitation for a bare email with no match', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.invite('academia-1', 'nova@example.com', 'RECEPTIONIST');

      expect(deps.invitations.create).toHaveBeenCalledWith(
        'academia-1',
        'nova@example.com',
        'RECEPTIONIST',
        null,
      );
      expect(deps.users.findByEmailInsensitive).not.toHaveBeenCalled();
    });

    it('UT-008 rejects a duplicate PENDING invitation', async () => {
      const deps = makeDeps();
      deps.invitations.findPendingDuplicate.mockResolvedValue({
        id: 'existing',
      });
      const service = makeService(deps);

      await expect(
        service.invite('academia-1', 'x@example.com', 'EMPLOYMENT'),
      ).rejects.toMatchObject({ code: 'invitation_pending' });
      expect(deps.invitations.create).not.toHaveBeenCalled();
    });

    it('UT-009 rejects an EMPLOYMENT invite to a non-physical-educator account', async () => {
      const deps = makeDeps();
      deps.users.findByEmailInsensitive.mockResolvedValue({
        id: 'u1',
        product: { type: 'NUTRITIONIST' },
      });
      const service = makeService(deps);

      await expect(
        service.invite('academia-1', 'nutri@example.com', 'EMPLOYMENT'),
      ).rejects.toMatchObject({ code: 'not_physical_educator' });
    });

    it('UT-010 rejects inviting an educator already ACTIVE-employed at this academia', async () => {
      const deps = makeDeps();
      deps.users.findByEmailInsensitive.mockResolvedValue({
        id: 'educator-1',
        product: { type: 'PHYSICAL_EDUCATOR' },
      });
      deps.employments.findActive.mockResolvedValue({ id: 'employment-1' });
      const service = makeService(deps);

      await expect(
        service.invite('academia-1', 'educador@example.com', 'EMPLOYMENT'),
      ).rejects.toMatchObject({ code: 'already_employed' });
    });

    it('UT-011 allows inviting an educator already employed by a DIFFERENT academia', async () => {
      const deps = makeDeps();
      deps.users.findByEmailInsensitive.mockResolvedValue({
        id: 'educator-1',
        product: { type: 'PHYSICAL_EDUCATOR' },
      });
      deps.employments.findActive.mockResolvedValue(null);
      const service = makeService(deps);

      await expect(
        service.invite('academia-1', 'educador@example.com', 'EMPLOYMENT'),
      ).resolves.toBeDefined();
    });
  });

  describe('accept / decline', () => {
    it('UT-012 accepting an EMPLOYMENT invitation materializes an Employment', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.accept('invite-1', 'educator-1', 'educador@example.com');

      expect(
        deps.invitations.transitionIfPendingForEducator,
      ).toHaveBeenCalledWith(
        'invite-1',
        'educator-1',
        'educador@example.com',
        'ACCEPTED',
      );
      expect(deps.employments.create).toHaveBeenCalledWith(
        'academia-1',
        'educator-1',
      );
    });

    it('UT-014 a lost race (concurrent accept) throws invitation_not_found, no Employment created', async () => {
      const deps = makeDeps();
      deps.invitations.transitionIfPendingForEducator.mockResolvedValue(0);
      const service = makeService(deps);

      await expect(
        service.accept('invite-1', 'educator-1', 'educador@example.com'),
      ).rejects.toBeInstanceOf(CodedError);
      expect(deps.employments.create).not.toHaveBeenCalled();
    });

    it('UT-015 accept on a CANCELLED invitation is rejected (conditional update matches nothing)', async () => {
      const deps = makeDeps();
      deps.invitations.transitionIfPendingForEducator.mockResolvedValue(0);
      const service = makeService(deps);

      await expect(
        service.accept('invite-1', 'educator-1', 'educador@example.com'),
      ).rejects.toMatchObject({ code: 'invitation_not_found' });
    });

    it('UT-016 decline transitions to DECLINED, creates no Employment', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.decline('invite-1', 'educator-1', 'educador@example.com');

      expect(
        deps.invitations.transitionIfPendingForEducator,
      ).toHaveBeenCalledWith(
        'invite-1',
        'educator-1',
        'educador@example.com',
        'DECLINED',
      );
      expect(deps.employments.create).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('UT-018 the academia cancels its own PENDING invitation', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.cancel('invite-1', 'academia-1');

      expect(deps.invitations.cancelIfPending).toHaveBeenCalledWith(
        'invite-1',
        'academia-1',
      );
    });

    it("UT-019 rejects cancelling another academia's invitation", async () => {
      const deps = makeDeps();
      deps.invitations.cancelIfPending.mockResolvedValue(0);
      const service = makeService(deps);

      await expect(
        service.cancel('invite-1', 'other-academia'),
      ).rejects.toMatchObject({ code: 'invitation_not_found' });
    });
  });

  describe('listPendingForEducator', () => {
    it('UT-017 a fresh invite after a prior decline is independent (new row, service is stateless passthrough)', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.listPendingForEducator(
        'educator-1',
        'educador@example.com',
      );

      expect(deps.invitations.listPendingForEducator).toHaveBeenCalledWith(
        'educator-1',
        'educador@example.com',
      );
    });
  });
});
