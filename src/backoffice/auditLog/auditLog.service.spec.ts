import { AcademiaStaffMemberRepository } from '@/repositories/academia/academiaStaffMember.repository';
import { BackofficeViewAsSessionRepository } from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { ViewAsTargetKind } from '@prisma/client';
import { AuditLogService } from './auditLog.service';

describe('AuditLogService — platform-admin-access UT-025', () => {
  const sessions = { findForAudit: jest.fn() };
  const users = { findManyByIds: jest.fn() };
  const staffMembers = { findManyByIds: jest.fn() };

  const service = new AuditLogService(
    sessions as unknown as BackofficeViewAsSessionRepository,
    users as unknown as UserRepository,
    staffMembers as unknown as AcademiaStaffMemberRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    users.findManyByIds.mockResolvedValue([]);
    staffMembers.findManyByIds.mockResolvedValue([]);
  });

  it('UT-025: a completed session shows the correct staff member, target, reason, start, and end', async () => {
    const startedAt = new Date('2026-10-15T13:00:00.000Z');
    const endedAt = new Date('2026-10-15T13:20:00.000Z');
    sessions.findForAudit.mockResolvedValue({
      items: [
        {
          id: 'session-1',
          staff: { name: 'Ana Suporte', email: 'ana@vitaflow.com' },
          targetKind: ViewAsTargetKind.USER,
          targetUserId: 'user-1',
          targetStaffId: null,
          reason: 'Investigando chamado #42',
          startedAt,
          endedAt,
        },
      ],
      total: 1,
    });
    users.findManyByIds.mockResolvedValue([
      { id: 'user-1', name: 'Carlos Aluno', email: 'carlos@example.com' },
    ]);

    const result = await service.list({}, 1);

    expect(result.items).toEqual([
      {
        id: 'session-1',
        staffName: 'Ana Suporte',
        staffEmail: 'ana@vitaflow.com',
        targetName: 'Carlos Aluno',
        targetEmail: 'carlos@example.com',
        reason: 'Investigando chamado #42',
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
      },
    ]);
  });

  it('resolves an ACADEMIA_STAFF target from the receptionist directory instead of Users', async () => {
    sessions.findForAudit.mockResolvedValue({
      items: [
        {
          id: 'session-2',
          staff: { name: 'Ana Suporte', email: 'ana@vitaflow.com' },
          targetKind: ViewAsTargetKind.ACADEMIA_STAFF,
          targetUserId: null,
          targetStaffId: 'staff-1',
          reason: 'Verificando acesso',
          startedAt: new Date('2026-10-15T14:00:00.000Z'),
          endedAt: null,
        },
      ],
      total: 1,
    });
    staffMembers.findManyByIds.mockResolvedValue([
      { id: 'staff-1', name: 'Recepção Academia X', email: 'recepcao@x.test' },
    ]);

    const result = await service.list({}, 1);

    expect(result.items[0].targetName).toBe('Recepção Academia X');
    expect(result.items[0].endedAt).toBeNull();
  });
});
