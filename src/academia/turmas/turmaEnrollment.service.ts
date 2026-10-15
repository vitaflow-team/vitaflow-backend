import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { TurmaEnrollmentRepository } from '@/repositories/academia/turmaEnrollment.repository';
import { TurmasRepository } from '@/repositories/academia/turmas.repository';
import { CodedError } from '@/common/errors/codedError';
import { Injectable } from '@nestjs/common';

const TURMA_NOT_FOUND = 'Turma não encontrada.';
const NOT_ELIGIBLE = 'Este aluno não pode se inscrever nesta turma.';
const TURMA_FULL = 'Turma cheia.';

export interface TurmaWithEnrollmentFlag {
  id: string;
  academiaId: string;
  academiaName: string;
  name: string;
  weekday: number;
  startMinute: number;
  durationMinutes: number;
  capacity: number;
  enrolledCount: number;
  responsibleEducator: { id: string; name: string } | null;
  enrolled: boolean;
}

@Injectable()
export class TurmaEnrollmentService {
  constructor(
    private readonly enrollments: TurmaEnrollmentRepository,
    private readonly turmas: TurmasRepository,
    private readonly clients: ClientsRepository,
  ) {}

  async enroll(turmaId: string, clientId: string): Promise<void> {
    await this.enrollments.withTurmaLock(turmaId, async (tx) => {
      const already = await this.enrollments.findEnrollment(
        turmaId,
        clientId,
        tx,
      );
      if (already) return;

      const turma = await this.turmas.findLiveByIdAnyAcademia(turmaId, tx);
      if (!turma) {
        throw new CodedError(TURMA_NOT_FOUND, 404, 'turma_not_found');
      }

      const client = await this.clients.getClientById(clientId);
      if (!client || client.academiaId !== turma.academiaId) {
        throw new CodedError(NOT_ELIGIBLE, 403, 'not_eligible');
      }

      const count = await this.enrollments.countEnrollments(turmaId, tx);
      if (count >= turma.capacity) {
        throw new CodedError(TURMA_FULL, 409, 'turma_full');
      }
      await this.enrollments.createEnrollment(turmaId, clientId, tx);
    });
  }

  async cancel(turmaId: string, clientId: string): Promise<void> {
    await this.enrollments.deleteEnrollment(turmaId, clientId);
  }

  async enrollSelf(userId: string, turmaId: string): Promise<void> {
    const turma = await this.turmas.findLiveByIdAnyAcademia(turmaId);
    if (!turma) {
      throw new CodedError(TURMA_NOT_FOUND, 404, 'turma_not_found');
    }
    const client = await this.clients.findByUserAndAcademiaId(
      userId,
      turma.academiaId,
    );
    if (!client) {
      throw new CodedError(NOT_ELIGIBLE, 403, 'not_eligible');
    }
    await this.enroll(turmaId, client.id);
  }

  async cancelSelf(userId: string, turmaId: string): Promise<void> {
    const turma = await this.turmas.findLiveByIdAnyAcademia(turmaId);
    if (!turma) return;
    const client = await this.clients.findByUserAndAcademiaId(
      userId,
      turma.academiaId,
    );
    if (!client) return;
    await this.cancel(turmaId, client.id);
  }

  async enrollManual(
    academiaId: string,
    turmaId: string,
    clientId: string,
  ): Promise<void> {
    const turma = await this.turmas.findLiveById(academiaId, turmaId);
    if (!turma) {
      throw new CodedError(TURMA_NOT_FOUND, 404, 'turma_not_found');
    }
    await this.enroll(turmaId, clientId);
  }

  async listForStudent(userId: string): Promise<TurmaWithEnrollmentFlag[]> {
    const ownedClients = await this.clients.findAcademiaOwnedByUserId(userId);
    const academiaIds = [
      ...new Set(ownedClients.map((client) => client.academiaId!)),
    ];
    const [turmas, enrolledTurmaIds] = await Promise.all([
      this.enrollments.findLiveTurmasByAcademiaIds(academiaIds),
      this.enrollments.findEnrolledTurmaIds(
        ownedClients.map((client) => client.id),
      ),
    ]);

    return turmas.map((turma) => ({
      id: turma.id,
      academiaId: turma.academia.id,
      academiaName: turma.academia.name,
      name: turma.name,
      weekday: turma.weekday,
      startMinute: turma.startMinute,
      durationMinutes: turma.durationMinutes,
      capacity: turma.capacity,
      enrolledCount: turma._count.enrollments,
      responsibleEducator: turma.professional
        ? { id: turma.professional.id, name: turma.professional.name }
        : null,
      enrolled: enrolledTurmaIds.has(turma.id),
    }));
  }
}
