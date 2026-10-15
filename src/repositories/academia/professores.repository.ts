import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import {
  AcademiaInvitationKind,
  AcademiaInvitationStatus,
  EmploymentStatus,
} from '@prisma/client';

export interface ActiveEmploymentRow {
  id: string;
  educatorId: string;
  name: string;
  email: string;
  startedAt: Date;
}

export interface PendingEmploymentInvitationRow {
  id: string;
  educatorId: string | null;
  email: string;
}

@Injectable()
export class ProfessoresRepository {
  constructor(private readonly prisma: PrismaService) {}

  async searchActiveByAcademia(
    academiaId: string,
    search?: string,
  ): Promise<ActiveEmploymentRow[]> {
    const rows = await this.prisma.employment.findMany({
      where: {
        academiaId,
        status: EmploymentStatus.ACTIVE,
        ...(search
          ? {
              educator: {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { email: { contains: search, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      include: { educator: { select: { id: true, name: true, email: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      educatorId: row.educatorId,
      name: row.educator.name,
      email: row.educator.email,
      startedAt: row.startedAt,
    }));
  }

  async searchPendingEmploymentByAcademia(
    academiaId: string,
    search?: string,
  ): Promise<PendingEmploymentInvitationRow[]> {
    const rows = await this.prisma.academiaInvitation.findMany({
      where: {
        academiaId,
        kind: AcademiaInvitationKind.EMPLOYMENT,
        status: AcademiaInvitationStatus.PENDING,
        ...(search ? { email: { contains: search, mode: 'insensitive' } } : {}),
      },
      select: { id: true, educatorId: true, email: true },
    });

    return rows;
  }

  async findNamesByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const users = await this.prisma.users.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }

  async countClientsGroupedByProfessional(
    academiaId: string,
  ): Promise<Map<string, number>> {
    const groups = await this.prisma.client.groupBy({
      by: ['professionalId'],
      where: { academiaId, professionalId: { not: null } },
      _count: { _all: true },
    });

    return new Map(
      groups
        .filter((group) => group.professionalId !== null)
        .map((group) => [group.professionalId as string, group._count._all]),
    );
  }
}
