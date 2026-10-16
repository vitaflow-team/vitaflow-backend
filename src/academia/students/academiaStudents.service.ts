import { Clock } from '@/scheduling/clock.service';
import { FixedSessionsService } from '@/scheduling/fixed-times/fixedSessions.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { CodedError } from '@/common/errors/codedError';
import { Injectable } from '@nestjs/common';
import {
  buildAcademiaStudentsList,
  buildNextSessionMap,
  type AcademiaStudentRecord,
  type AcademiaStudentsListResult,
} from './academiaStudentsMerge.util';
import { ListAcademiaStudentsQueryDTO } from './dto/listAcademiaStudents.Dto';

const STUDENT_NOT_FOUND = 'Aluno não encontrado nesta academia.';
const EDUCATOR_NOT_EMPLOYED =
  'Este educador não está mais empregado por esta academia.';
export const ACADEMIA_STUDENTS_PAGE_SIZE = 50;

@Injectable()
export class AcademiaStudentsService {
  constructor(
    private readonly clients: ClientsRepository,
    private readonly employments: EmploymentRepository,
    private readonly fixedSessions: FixedSessionsService,
    private readonly clock: Clock,
  ) {}

  async list(
    academiaId: string,
    query: ListAcademiaStudentsQueryDTO,
  ): Promise<AcademiaStudentsListResult> {
    const rows = await this.clients.findAllByAcademiaId(academiaId);

    const assigned = rows
      .filter((row) => row.professionalId !== null)
      .map((row) => ({
        clientId: row.id,
        userId: row.userId,
        professionalId: row.professionalId!,
      }));
    const nextSessionByClientId = await buildNextSessionMap(
      assigned,
      this.clock.now(),
      (professionalId, records, now) =>
        this.fixedSessions.nextForRecords(professionalId, records, now),
    );

    const records: AcademiaStudentRecord[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      professionalId: row.professionalId,
      professionalName: row.professional?.name ?? null,
      userId: row.userId,
    }));

    return buildAcademiaStudentsList({
      records,
      nextSessionByClientId,
      search: query.search,
      horario: query.horario,
      page: query.page ?? 1,
      pageSize: ACADEMIA_STUDENTS_PAGE_SIZE,
    });
  }

  async assignEducator(
    academiaId: string,
    clientId: string,
    professionalId: string | null,
  ): Promise<void> {
    if (professionalId) {
      const active = await this.employments.findActive(
        academiaId,
        professionalId,
      );
      if (!active) {
        throw new CodedError(EDUCATOR_NOT_EMPLOYED, 400, 'not_employed_here');
      }
    }

    const assigned = await this.clients.assignEducator(
      clientId,
      academiaId,
      professionalId,
    );
    if (!assigned) {
      throw new CodedError(STUDENT_NOT_FOUND, 404, 'student_not_found');
    }
  }
}
