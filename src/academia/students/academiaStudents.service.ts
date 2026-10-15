import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { CodedError } from '@/common/errors/codedError';
import { Injectable } from '@nestjs/common';
import { Client } from '@prisma/client';

const STUDENT_NOT_FOUND = 'Aluno não encontrado nesta academia.';
const EDUCATOR_NOT_EMPLOYED =
  'Este educador não está mais empregado por esta academia.';

@Injectable()
export class AcademiaStudentsService {
  constructor(
    private readonly clients: ClientsRepository,
    private readonly employments: EmploymentRepository,
  ) {}

  async list(academiaId: string): Promise<Client[]> {
    return await this.clients.findAllByAcademiaId(academiaId);
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
