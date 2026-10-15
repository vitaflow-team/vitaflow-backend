import { turmaLockKey } from '@/academia/turmas/turmaEnrollment.util';
import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma, Turma, TurmaEnrollment } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export type TurmaForStudent = Turma & {
  professional: { id: string; name: string } | null;
  academia: { id: string; name: string };
  _count: { enrollments: number };
};

@Injectable()
export class TurmaEnrollmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async withTurmaLock<T>(
    turmaId: string,
    work: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${turmaLockKey(turmaId)}))`;
      return await work(tx);
    });
  }

  async findEnrollment(
    turmaId: string,
    clientId: string,
    tx: Tx = this.prisma,
  ): Promise<TurmaEnrollment | null> {
    return await tx.turmaEnrollment.findUnique({
      where: { turmaId_clientId: { turmaId, clientId } },
    });
  }

  async countEnrollments(
    turmaId: string,
    tx: Tx = this.prisma,
  ): Promise<number> {
    return await tx.turmaEnrollment.count({ where: { turmaId } });
  }

  async createEnrollment(
    turmaId: string,
    clientId: string,
    tx: Tx = this.prisma,
  ): Promise<TurmaEnrollment> {
    return await tx.turmaEnrollment.create({ data: { turmaId, clientId } });
  }

  async deleteEnrollment(turmaId: string, clientId: string): Promise<void> {
    await this.prisma.turmaEnrollment.deleteMany({
      where: { turmaId, clientId },
    });
  }

  async findLiveTurmasByAcademiaIds(
    academiaIds: string[],
  ): Promise<TurmaForStudent[]> {
    if (academiaIds.length === 0) return [];
    return await this.prisma.turma.findMany({
      where: { academiaId: { in: academiaIds }, removedAt: null },
      include: {
        professional: { select: { id: true, name: true } },
        academia: { select: { id: true, name: true } },
        _count: { select: { enrollments: true } },
      },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });
  }

  async findEnrolledTurmaIds(clientIds: string[]): Promise<Set<string>> {
    if (clientIds.length === 0) return new Set();
    const rows = await this.prisma.turmaEnrollment.findMany({
      where: { clientId: { in: clientIds } },
      select: { turmaId: true },
    });
    return new Set(rows.map((row) => row.turmaId));
  }
}
