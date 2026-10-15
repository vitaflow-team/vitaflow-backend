import { PrismaService } from '@/database/prisma.service';
import { TimeRange } from '@/scheduling/fixed-times/fixedTime.util';
import { Injectable } from '@nestjs/common';
import { Prisma, Turma, TurmaSession } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface TurmaData {
  academiaId: string;
  name: string;
  professionalId: string | null;
  weekday: number;
  startMinute: number;
  durationMinutes: number;
  capacity: number;
}

export type TurmaRuleFields = Partial<
  Pick<
    TurmaData,
    'name' | 'weekday' | 'startMinute' | 'durationMinutes' | 'capacity'
  >
>;

export type TurmaWithAgendaFields = Turma & {
  professional: { id: string; name: string } | null;
  _count: { enrollments: number };
};

export type TurmaSessionData = TimeRange & { turmaId: string };

@Injectable()
export class TurmasRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: TurmaData, tx: Tx = this.prisma): Promise<Turma> {
    return await tx.turma.create({ data });
  }

  async findLiveById(
    academiaId: string,
    turmaId: string,
    tx: Tx = this.prisma,
  ): Promise<Turma | null> {
    return await tx.turma.findFirst({
      where: { id: turmaId, academiaId, removedAt: null },
    });
  }

  async findLiveByIdAnyAcademia(
    turmaId: string,
    tx: Tx = this.prisma,
  ): Promise<Turma | null> {
    return await tx.turma.findFirst({
      where: { id: turmaId, removedAt: null },
    });
  }

  async update(
    turmaId: string,
    data: TurmaRuleFields,
    tx: Tx = this.prisma,
  ): Promise<Turma> {
    return await tx.turma.update({ where: { id: turmaId }, data });
  }

  async assignEducator(
    turmaId: string,
    professionalId: string | null,
    tx: Tx = this.prisma,
  ): Promise<Turma> {
    return await tx.turma.update({
      where: { id: turmaId },
      data: { professionalId },
    });
  }

  async softRemove(
    academiaId: string,
    turmaId: string,
    tx: Tx = this.prisma,
  ): Promise<boolean> {
    const { count } = await tx.turma.updateMany({
      where: { id: turmaId, academiaId, removedAt: null },
      data: { removedAt: new Date() },
    });
    return count === 1;
  }

  async findAllLiveByAcademia(
    academiaId: string,
  ): Promise<TurmaWithAgendaFields[]> {
    return await this.prisma.turma.findMany({
      where: { academiaId, removedAt: null },
      include: {
        professional: { select: { id: true, name: true } },
        _count: { select: { enrollments: true } },
      },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });
  }

  async findAllLiveRules(): Promise<Turma[]> {
    return await this.prisma.turma.findMany({
      where: { removedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findRuleSessionsBetween(
    turmaId: string,
    window: TimeRange,
    tx: Tx = this.prisma,
  ): Promise<TurmaSession[]> {
    return await tx.turmaSession.findMany({
      where: { turmaId, startAt: { gte: window.startAt, lte: window.endAt } },
    });
  }

  async createSessionsSkippingDuplicates(
    rows: TurmaSessionData[],
    tx: Tx = this.prisma,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const result = await tx.turmaSession.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return result.count;
  }

  async deleteFutureSessions(
    turmaId: string,
    now: Date,
    tx: Tx = this.prisma,
  ): Promise<void> {
    await tx.turmaSession.deleteMany({
      where: { turmaId, startAt: { gt: now } },
    });
  }
}
