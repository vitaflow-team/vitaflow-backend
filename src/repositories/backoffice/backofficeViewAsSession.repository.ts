import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { BackofficeViewAsSession, ViewAsTargetKind } from '@prisma/client';

export interface CreateViewAsSessionData {
  staffUserId: string;
  targetKind: ViewAsTargetKind;
  targetUserId: string | null;
  targetStaffId: string | null;
  reason: string;
  expiresAt: Date;
}

export interface AuditLogFilter {
  staffId?: string;
  targetId?: string;
}

export type ViewAsSessionWithStaff = BackofficeViewAsSession & {
  staff: { name: string; email: string };
};

@Injectable()
export class BackofficeViewAsSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: CreateViewAsSessionData,
  ): Promise<BackofficeViewAsSession> {
    return await this.prisma.backofficeViewAsSession.create({ data });
  }

  async findById(id: string): Promise<BackofficeViewAsSession | null> {
    return await this.prisma.backofficeViewAsSession.findUnique({
      where: { id },
    });
  }

  // Idempotent: a session already ended (manually or by the expiry sweep)
  // is left exactly as-is — the `endedAt: null` guard means a repeated call
  // matches nothing and changes nothing.
  async end(id: string): Promise<void> {
    await this.prisma.backofficeViewAsSession.updateMany({
      where: { id, endedAt: null },
      data: { endedAt: new Date() },
    });
  }

  // Staff removal immediately ends every session still open for them
  // (platform-admin-access ADR-004 dual revalidation) — an already-ended
  // session is left untouched.
  async endAllOpenForStaff(staffUserId: string): Promise<void> {
    await this.prisma.backofficeViewAsSession.updateMany({
      where: { staffUserId, endedAt: null },
      data: { endedAt: new Date() },
    });
  }

  async findForAudit(
    filter: AuditLogFilter,
    page: number,
    pageSize: number,
  ): Promise<{ items: ViewAsSessionWithStaff[]; total: number }> {
    const where = {
      ...(filter.staffId ? { staffUserId: filter.staffId } : {}),
      ...(filter.targetId
        ? {
            OR: [
              { targetUserId: filter.targetId },
              { targetStaffId: filter.targetId },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.backofficeViewAsSession.findMany({
        where,
        include: { staff: { select: { name: true, email: true } } },
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.backofficeViewAsSession.count({ where }),
    ]);

    return { items, total };
  }

  // Hand-authored raw SQL (platform-admin-access ADR-007): each row's own
  // `expiresAt` becomes its `endedAt` — never a single shared "now" for
  // every row the sweep happens to touch in one run.
  async closeExpiredSessions(): Promise<number> {
    return await this.prisma.$executeRaw`
      UPDATE "BackofficeViewAsSession"
      SET "endedAt" = "expiresAt"
      WHERE "endedAt" IS NULL AND "expiresAt" < NOW()
    `;
  }

  async purgeOlderThan(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.backofficeViewAsSession.deleteMany({
      where: { startedAt: { lt: cutoff } },
    });
    return count;
  }
}
