import { AcademiaActivityService } from '@/academia/activity/academiaActivity.service';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { CodedError } from '@/common/errors/codedError';
import { Injectable } from '@nestjs/common';
import { Employment } from '@prisma/client';

const EMPLOYMENT_NOT_FOUND = 'Vínculo não encontrado ou já encerrado.';

@Injectable()
export class EmploymentService {
  constructor(
    private readonly employments: EmploymentRepository,
    private readonly activity: AcademiaActivityService,
  ) {}

  async end(academiaId: string, employmentId: string): Promise<void> {
    const employment = await this.employments.findById(employmentId);
    if (!employment || employment.academiaId !== academiaId) {
      throw new CodedError(EMPLOYMENT_NOT_FOUND, 404, 'employment_not_found');
    }
    await this.employments.end(academiaId, employmentId);
    await this.activity.recordActivity(
      academiaId,
      `Vínculo encerrado com o educador ${employment.educatorId}.`,
    );
  }

  async listActiveByAcademia(academiaId: string) {
    return await this.employments.listActiveByAcademia(academiaId);
  }

  async listActiveByEducator(educatorId: string) {
    return await this.employments.listActiveByEducator(educatorId);
  }
}

export type { Employment };
