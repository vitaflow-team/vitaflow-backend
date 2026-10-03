import { CodedError } from '@/common/errors/codedError';
import { ConsentService } from '@/common/consent/consent.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import {
  AssessmentInput,
  PhysicalAssessmentsRepository,
} from '@/repositories/physical-assessments/physicalAssessments.repository';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { findOwnedStudent } from '../students/studentOwnership.util';
import { parseAssessedOn } from './assessedOnTimestamp.util';
import {
  ASSESSMENTS_PAGE_SIZE,
  DECLARATION_FEATURE,
} from './assessmentLimits.constants';
import { toAssessmentResponse } from './assessmentFormat.util';
import { computeVariation } from './assessmentVariation.util';
import {
  AssessmentListResponseDTO,
  DeclarationStatusDTO,
} from './dto/assessmentList.Dto';
import { AssessmentResponseDTO } from './dto/assessmentResponse.Dto';
import { AssessmentValuesDTO } from './dto/assessmentValues.Dto';
import { CreateAssessmentDTO } from './dto/createAssessment.Dto';

const ASSESSMENT_NOT_FOUND = 'Avaliação não encontrada.';
const DECLARATION_REQUIRED =
  'Aceite a declaração de responsabilidade sobre dados de saúde antes de registrar a primeira avaliação.';

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function toInput(dto: AssessmentValuesDTO): AssessmentInput {
  return {
    assessedOn: parseAssessedOn(dto.assessedOn),
    weightKg: dto.weightKg,
    heightCm: dto.heightCm,
    bodyFatPercent: dto.bodyFatPercent ?? null,
    restingHeartRate: dto.restingHeartRate ?? null,
    flexibilityCm: dto.flexibilityCm ?? null,
    armCm: dto.armCm ?? null,
    chestCm: dto.chestCm ?? null,
    waistCm: dto.waistCm ?? null,
    abdomenCm: dto.abdomenCm ?? null,
    hipCm: dto.hipCm ?? null,
    thighCm: dto.thighCm ?? null,
    calfCm: dto.calfCm ?? null,
  };
}

@Injectable()
export class AssessmentsService {
  private readonly logger = new Logger(AssessmentsService.name);

  constructor(
    private readonly clients: ClientsRepository,
    private readonly assessments: PhysicalAssessmentsRepository,
    private readonly consent: ConsentService,
  ) {}

  async list(
    educatorId: string,
    studentId: string,
    page = 1,
  ): Promise<AssessmentListResponseDTO> {
    const student = await findOwnedStudent(this.clients, educatorId, studentId);
    const [{ items, total }, all] = await Promise.all([
      this.assessments.listByClient(
        student.id,
        (page - 1) * ASSESSMENTS_PAGE_SIZE,
        ASSESSMENTS_PAGE_SIZE,
      ),
      this.assessments.findAllForVariation(student.id),
    ]);

    return {
      items: items.map(toAssessmentResponse),
      total,
      page,
      pageSize: ASSESSMENTS_PAGE_SIZE,
      variation: computeVariation(all),
    };
  }

  // Ownership first, so a foreign or removed student never produces a consent
  // row. Saving needs the educator's one-time declaration on record: it is
  // accepted inline with the first save, recorded before the assessment so an
  // assessment can never exist without it.
  async create(
    educatorId: string,
    studentId: string,
    dto: CreateAssessmentDTO,
  ): Promise<AssessmentResponseDTO> {
    const student = await findOwnedStudent(this.clients, educatorId, studentId);
    await this.ensureDeclaration(educatorId, dto.acceptDeclaration === true);

    const created = await this.assessments.create(student.id, toInput(dto));
    this.logger.log(
      `assessment_saved educatorId=${educatorId} studentId=${student.id} assessmentId=${created.id}`,
    );
    return toAssessmentResponse(created);
  }

  async update(
    educatorId: string,
    studentId: string,
    assessmentId: string,
    dto: AssessmentValuesDTO,
  ): Promise<AssessmentResponseDTO> {
    const assessment = await this.findOwnedAssessment(
      educatorId,
      studentId,
      assessmentId,
    );
    const updated = await this.assessments.update(assessment.id, toInput(dto));
    this.logger.log(
      `assessment_updated educatorId=${educatorId} assessmentId=${updated.id}`,
    );
    return toAssessmentResponse(updated);
  }

  async remove(
    educatorId: string,
    studentId: string,
    assessmentId: string,
  ): Promise<void> {
    const assessment = await this.findOwnedAssessment(
      educatorId,
      studentId,
      assessmentId,
    );
    await this.assessments.delete(assessment.id);
    this.logger.log(
      `assessment_deleted educatorId=${educatorId} assessmentId=${assessment.id}`,
    );
  }

  async declarationStatus(educatorId: string): Promise<DeclarationStatusDTO> {
    return {
      accepted: await this.consent.hasConsented(
        educatorId,
        DECLARATION_FEATURE,
      ),
    };
  }

  private async findOwnedAssessment(
    educatorId: string,
    studentId: string,
    assessmentId: string,
  ) {
    const student = await findOwnedStudent(this.clients, educatorId, studentId);
    const assessment = await this.assessments.findOwned(
      assessmentId,
      student.id,
    );
    if (!assessment) {
      throw new CodedError(ASSESSMENT_NOT_FOUND, 404, 'assessment_not_found');
    }
    return assessment;
  }

  private async ensureDeclaration(
    educatorId: string,
    acceptNow: boolean,
  ): Promise<void> {
    if (await this.consent.hasConsented(educatorId, DECLARATION_FEATURE)) {
      return;
    }
    if (!acceptNow) {
      throw new CodedError(DECLARATION_REQUIRED, 403, 'declaration_required');
    }

    try {
      await this.consent.giveConsent(educatorId, DECLARATION_FEATURE);
      this.logger.log(`declaration_accepted educatorId=${educatorId}`);
    } catch (error) {
      // Accepted from another tab at the same moment: already on record.
      if (!isUniqueViolation(error)) throw error;
    }
  }
}
