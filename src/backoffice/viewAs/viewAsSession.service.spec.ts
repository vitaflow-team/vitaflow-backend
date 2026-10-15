import { BackofficeViewAsSessionRepository } from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { BackofficeTier, ViewAsTargetKind } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { ViewAsSessionService } from './viewAsSession.service';

describe('ViewAsSessionService — platform-admin-access UT-007, UT-008, UT-015', () => {
  const sessions = {
    create: jest.fn(),
    findById: jest.fn(),
    end: jest.fn(),
  };
  const users = { findUnique: jest.fn() };
  const jwtService = { signAsync: jest.fn() };

  const service = new ViewAsSessionService(
    sessions as unknown as BackofficeViewAsSessionRepository,
    users as unknown as UserRepository,
    jwtService as unknown as JwtService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('start', () => {
    it('UT-007: creates a BackofficeViewAsSession and a token with expiresAt = startedAt + 30min', async () => {
      sessions.create.mockResolvedValue({ id: 'session-1' });
      jwtService.signAsync.mockResolvedValue('signed-token');

      const before = Date.now();
      const result = await service.start({
        staffUserId: 'staff-1',
        targetKind: ViewAsTargetKind.USER,
        targetId: 'target-1',
        reason: 'Suporte ao chamado #42',
      });
      const after = Date.now();

      expect(sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          staffUserId: 'staff-1',
          targetKind: ViewAsTargetKind.USER,
          targetUserId: 'target-1',
          targetStaffId: null,
          reason: 'Suporte ao chamado #42',
        }),
      );
      const expiresAtMs = new Date(result.expiresAt).getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + 30 * 60 * 1000);
      expect(result.sessionId).toBe('session-1');
      expect(result.token).toBe('signed-token');
    });

    it('UT-007: targeting an ACADEMIA_STAFF row sets targetStaffId, not targetUserId', async () => {
      sessions.create.mockResolvedValue({ id: 'session-2' });
      jwtService.signAsync.mockResolvedValue('signed-token');

      await service.start({
        staffUserId: 'staff-1',
        targetKind: ViewAsTargetKind.ACADEMIA_STAFF,
        targetId: 'receptionist-1',
        reason: 'Investigando um chamado',
      });

      expect(sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          targetUserId: null,
          targetStaffId: 'receptionist-1',
        }),
      );
    });

    it('UT-008: rejects an empty reason, no session row created', async () => {
      await expect(
        service.start({
          staffUserId: 'staff-1',
          targetKind: ViewAsTargetKind.USER,
          targetId: 'target-1',
          reason: '',
        }),
      ).rejects.toMatchObject({ code: 'reason_required' });
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('UT-008: rejects a blank (whitespace-only) reason', async () => {
      await expect(
        service.start({
          staffUserId: 'staff-1',
          targetKind: ViewAsTargetKind.USER,
          targetId: 'target-1',
          reason: '   ',
        }),
      ).rejects.toMatchObject({ code: 'reason_required' });
      expect(sessions.create).not.toHaveBeenCalled();
    });
  });

  describe('end', () => {
    it('UT-015: sets endedAt by delegating to the repository for the session owner', async () => {
      sessions.findById.mockResolvedValue({
        id: 'session-1',
        staffUserId: 'staff-1',
        endedAt: null,
      });

      await service.end('session-1', 'staff-1');

      expect(sessions.end).toHaveBeenCalledWith('session-1');
    });

    it('UT-015: calling end() again on an already-ended session is a silent no-op, not an error', async () => {
      sessions.findById.mockResolvedValue({
        id: 'session-1',
        staffUserId: 'staff-1',
        endedAt: new Date(),
      });

      await expect(
        service.end('session-1', 'staff-1'),
      ).resolves.toBeUndefined();
      expect(sessions.end).not.toHaveBeenCalled();
    });

    it('a nonexistent session id is a silent no-op, not an error', async () => {
      sessions.findById.mockResolvedValue(null);

      await expect(service.end('ghost', 'staff-1')).resolves.toBeUndefined();
      expect(sessions.end).not.toHaveBeenCalled();
    });

    it("an admin interno may end another staff member's open session", async () => {
      sessions.findById.mockResolvedValue({
        id: 'session-1',
        staffUserId: 'other-staff',
        endedAt: null,
      });
      users.findUnique.mockResolvedValue({
        backofficeTier: BackofficeTier.ADMIN,
      });

      await service.end('session-1', 'admin-1');

      expect(sessions.end).toHaveBeenCalledWith('session-1');
    });

    it("a non-admin may not end another staff member's open session", async () => {
      sessions.findById.mockResolvedValue({
        id: 'session-1',
        staffUserId: 'other-staff',
        endedAt: null,
      });
      users.findUnique.mockResolvedValue({
        backofficeTier: BackofficeTier.EQUIPE,
      });

      await expect(service.end('session-1', 'equipe-1')).rejects.toMatchObject({
        code: 'not_session_owner',
      });
      expect(sessions.end).not.toHaveBeenCalled();
    });
  });
});
