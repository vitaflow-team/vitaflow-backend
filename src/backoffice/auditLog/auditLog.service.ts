import { AcademiaStaffMemberRepository } from '@/repositories/academia/academiaStaffMember.repository';
import {
  AuditLogFilter,
  BackofficeViewAsSessionRepository,
  ViewAsSessionWithStaff,
} from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Injectable } from '@nestjs/common';
import { ViewAsTargetKind } from '@prisma/client';

export const AUDIT_LOG_PAGE_SIZE = 50;

export interface AuditLogEntry {
  id: string;
  staffName: string;
  staffEmail: string;
  targetName: string | null;
  targetEmail: string | null;
  reason: string;
  startedAt: string;
  endedAt: string | null;
}

export interface AuditLogListResult {
  items: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class AuditLogService {
  constructor(
    private readonly sessions: BackofficeViewAsSessionRepository,
    private readonly users: UserRepository,
    private readonly staffMembers: AcademiaStaffMemberRepository,
  ) {}

  async list(
    filter: AuditLogFilter,
    page: number,
  ): Promise<AuditLogListResult> {
    const { items, total } = await this.sessions.findForAudit(
      filter,
      page,
      AUDIT_LOG_PAGE_SIZE,
    );

    const userIds = items
      .filter((s) => s.targetKind === ViewAsTargetKind.USER)
      .map((s) => s.targetUserId!);
    const staffIds = items
      .filter((s) => s.targetKind === ViewAsTargetKind.ACADEMIA_STAFF)
      .map((s) => s.targetStaffId!);

    const [targetUsers, targetStaff] = await Promise.all([
      this.users.findManyByIds(userIds),
      this.staffMembers.findManyByIds(staffIds),
    ]);
    const userMap = new Map(targetUsers.map((u) => [u.id, u]));
    const staffMap = new Map(targetStaff.map((s) => [s.id, s]));

    return {
      items: items.map((session) => this.toEntry(session, userMap, staffMap)),
      total,
      page,
      pageSize: AUDIT_LOG_PAGE_SIZE,
    };
  }

  private toEntry(
    session: ViewAsSessionWithStaff,
    userMap: Map<string, { name: string; email: string }>,
    staffMap: Map<string, { name: string; email: string }>,
  ): AuditLogEntry {
    const target =
      session.targetKind === ViewAsTargetKind.USER
        ? userMap.get(session.targetUserId!)
        : staffMap.get(session.targetStaffId!);

    return {
      id: session.id,
      staffName: session.staff.name,
      staffEmail: session.staff.email,
      targetName: target?.name ?? null,
      targetEmail: target?.email ?? null,
      reason: session.reason,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
    };
  }
}
