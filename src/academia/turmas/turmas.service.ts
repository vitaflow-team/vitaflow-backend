import { Clock } from '@/scheduling/clock.service';
import { FIXED_MATERIALIZE_DAYS } from '@/scheduling/fixed-times/fixedTime.constants';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { PrismaService } from '@/database/prisma.service';
import {
  TurmaRuleFields,
  TurmasRepository,
} from '@/repositories/academia/turmas.repository';
import { CodedError } from '@/common/errors/codedError';
import { Injectable } from '@nestjs/common';
import { Turma } from '@prisma/client';
import { TurmaSessionsRenewalService } from './turmaSessionsRenewal.service';
import {
  isScheduleShapeChange,
  validateCapacity,
  validateTurmaSchedule,
} from './turmaSchedule.util';

const TURMA_NOT_FOUND = 'Turma não encontrada nesta academia.';
const EDUCATOR_NOT_EMPLOYED =
  'Este educador não está mais empregado por esta academia.';
const INVALID_SCHEDULE = 'Verifique o horário e a duração informados.';
const INVALID_CAPACITY =
  'A capacidade deve ser um número inteiro maior que zero.';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CreateTurmaInput {
  academiaId: string;
  name: string;
  professionalId?: string;
  weekday: number;
  startMinute: number;
  durationMinutes: number;
  capacity: number;
}

export type UpdateTurmaInput = Partial<
  Pick<
    CreateTurmaInput,
    'name' | 'weekday' | 'startMinute' | 'durationMinutes' | 'capacity'
  >
>;

export interface TurmaAgendaItem {
  id: string;
  name: string;
  weekday: number;
  startMinute: number;
  durationMinutes: number;
  capacity: number;
  enrolledCount: number;
  responsibleEducator: { id: string; name: string } | null;
}

@Injectable()
export class TurmasService {
  constructor(
    private readonly turmas: TurmasRepository,
    private readonly employments: EmploymentRepository,
    private readonly renewal: TurmaSessionsRenewalService,
    private readonly clock: Clock,
    private readonly prisma: PrismaService,
  ) {}

  async create(input: CreateTurmaInput): Promise<Turma> {
    this.assertValidSchedule(input);
    if (input.professionalId) {
      await this.assertEmployed(input.academiaId, input.professionalId);
    }

    return await this.turmas.create({
      academiaId: input.academiaId,
      name: input.name,
      professionalId: input.professionalId ?? null,
      weekday: input.weekday,
      startMinute: input.startMinute,
      durationMinutes: input.durationMinutes,
      capacity: input.capacity,
    });
  }

  async update(
    turmaId: string,
    academiaId: string,
    patch: UpdateTurmaInput,
  ): Promise<Turma> {
    const turma = await this.findOwned(academiaId, turmaId);
    this.assertValidSchedule({
      weekday: patch.weekday ?? turma.weekday,
      startMinute: patch.startMinute ?? turma.startMinute,
      durationMinutes: patch.durationMinutes ?? turma.durationMinutes,
      capacity: patch.capacity ?? turma.capacity,
    });

    const data: TurmaRuleFields = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.weekday !== undefined) data.weekday = patch.weekday;
    if (patch.startMinute !== undefined) data.startMinute = patch.startMinute;
    if (patch.durationMinutes !== undefined) {
      data.durationMinutes = patch.durationMinutes;
    }
    if (patch.capacity !== undefined) data.capacity = patch.capacity;

    if (!isScheduleShapeChange(patch)) {
      return await this.turmas.update(turmaId, data);
    }

    const now = this.clock.now();
    const until = new Date(now.getTime() + FIXED_MATERIALIZE_DAYS * DAY_MS);
    return await this.prisma.$transaction(async (tx) => {
      const updated = await this.turmas.update(turmaId, data, tx);
      await this.turmas.deleteFutureSessions(turmaId, now, tx);
      await this.renewal.materializeForTurma(updated, now, until, tx);
      return updated;
    });
  }

  async assignEducator(
    turmaId: string,
    academiaId: string,
    professionalId: string | null,
  ): Promise<Turma> {
    await this.findOwned(academiaId, turmaId);
    if (professionalId) {
      await this.assertEmployed(academiaId, professionalId);
    }
    return await this.turmas.assignEducator(turmaId, professionalId);
  }

  async remove(turmaId: string, academiaId: string): Promise<void> {
    await this.turmas.softRemove(academiaId, turmaId);
  }

  async weeklyAgenda(academiaId: string): Promise<TurmaAgendaItem[]> {
    const rows = await this.turmas.findAllLiveByAcademia(academiaId);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      weekday: row.weekday,
      startMinute: row.startMinute,
      durationMinutes: row.durationMinutes,
      capacity: row.capacity,
      enrolledCount: row._count.enrollments,
      responsibleEducator: row.professional
        ? { id: row.professional.id, name: row.professional.name }
        : null,
    }));
  }

  private async findOwned(academiaId: string, turmaId: string): Promise<Turma> {
    const turma = await this.turmas.findLiveById(academiaId, turmaId);
    if (!turma) {
      throw new CodedError(TURMA_NOT_FOUND, 404, 'turma_not_found');
    }
    return turma;
  }

  private async assertEmployed(
    academiaId: string,
    professionalId: string,
  ): Promise<void> {
    const active = await this.employments.findActive(
      academiaId,
      professionalId,
    );
    if (!active) {
      throw new CodedError(EDUCATOR_NOT_EMPLOYED, 400, 'not_employed_here');
    }
  }

  private assertValidSchedule(rule: {
    weekday: number;
    startMinute: number;
    durationMinutes: number;
    capacity: number;
  }): void {
    const scheduleProblems = validateTurmaSchedule(rule);
    if (scheduleProblems.length > 0) {
      throw new CodedError(INVALID_SCHEDULE, 400, 'turma_invalid_schedule');
    }
    if (!validateCapacity(rule.capacity)) {
      throw new CodedError(INVALID_CAPACITY, 400, 'turma_invalid_capacity');
    }
  }
}
