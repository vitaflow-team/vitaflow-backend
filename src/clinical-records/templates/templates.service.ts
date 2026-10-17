import { CodedError } from '@/common/errors/codedError';
import {
  AssessmentTemplatesRepository,
  TemplateFieldInput,
  TemplateOwner,
  TemplateWithFields,
} from '@/repositories/clinical-records/assessmentTemplates.repository';
import { Injectable } from '@nestjs/common';
import { FormFieldType, ProductType, TemplatePurpose } from '@prisma/client';
import {
  EDUCATOR_ANAMNESE_FIELDS,
  EDUCATOR_ASSESSMENT_FIELDS,
  NUTRITIONIST_ANAMNESE_FIELDS,
  NUTRITIONIST_ASSESSMENT_FIELDS,
  STARTER_ANAMNESE_NAME,
  STARTER_ASSESSMENT_NAME,
} from '../starterTemplates';
import { CreateTemplateDTO } from './dto/createTemplate.Dto';
import { TemplateResponseDTO } from './dto/templateResponse.Dto';
import { UpdateTemplateDTO } from './dto/updateTemplate.Dto';

const TEMPLATE_NOT_FOUND = 'Modelo não encontrado.';
const EMPTY_FIELDS = 'Um modelo precisa de pelo menos um campo.';
const MISSING_OPTIONS =
  'Um campo de múltipla escolha precisa de pelo menos uma opção.';

export function toTemplateResponse(
  template: TemplateWithFields,
): TemplateResponseDTO {
  return {
    id: template.id,
    name: template.name,
    purpose: template.purpose,
    active: template.active,
    fields: template.fields.map((field) => ({
      id: field.id,
      position: field.position,
      label: field.label,
      fieldType: field.fieldType,
      options: field.options,
      required: field.required,
      weightRole: field.weightRole,
      heightRole: field.heightRole,
    })),
  };
}

@Injectable()
export class TemplatesService {
  constructor(private readonly templates: AssessmentTemplatesRepository) {}

  // Owner is resolved by the calling controller from the caller's own
  // session context (professionalId or academiaId) — never accepted as
  // caller-supplied input.
  async create(
    owner: TemplateOwner,
    dto: CreateTemplateDTO,
  ): Promise<TemplateResponseDTO> {
    this.assertValidFields(dto.fields);
    const created = await this.templates.create(
      owner,
      dto.name,
      dto.purpose,
      dto.fields,
    );
    return toTemplateResponse(created);
  }

  async list(
    owner: TemplateOwner,
    purpose?: TemplatePurpose,
  ): Promise<TemplateResponseDTO[]> {
    const templates = await this.templates.listByOwner(owner, purpose);
    return templates.map(toTemplateResponse);
  }

  async update(
    owner: TemplateOwner,
    id: string,
    dto: UpdateTemplateDTO,
  ): Promise<TemplateResponseDTO> {
    if (dto.fields) this.assertValidFields(dto.fields);
    const updated = await this.templates.update(id, owner, dto);
    if (!updated) {
      throw new CodedError(TEMPLATE_NOT_FOUND, 404, 'template_not_found');
    }
    return toTemplateResponse(updated);
  }

  // Soft-remove (US-004.EC-2): excluded from future-selection listings, past
  // records remain exactly as they were.
  async discontinue(owner: TemplateOwner, id: string): Promise<void> {
    const discontinued = await this.templates.discontinue(id, owner);
    if (!discontinued) {
      throw new CodedError(TEMPLATE_NOT_FOUND, 404, 'template_not_found');
    }
  }

  // Idempotent: a no-op once the owner already has templates of both
  // purposes (PRD ADR-004). Called from every real account-activation entry
  // point (subscription upgrade to a professional product, academia
  // provisioning) rather than lazily, so a brand-new account has them
  // immediately with no manual setup (IT-003).
  async ensureStarterTemplates(
    owner: TemplateOwner,
    professionalType: ProductType,
  ): Promise<void> {
    const [anamneseCount, assessmentCount] = await Promise.all([
      this.templates.countByOwner(owner, TemplatePurpose.ANAMNESE),
      this.templates.countByOwner(owner, TemplatePurpose.ASSESSMENT),
    ]);

    const isNutritionist = professionalType === ProductType.NUTRITIONIST;
    const anamneseFields = isNutritionist
      ? NUTRITIONIST_ANAMNESE_FIELDS
      : EDUCATOR_ANAMNESE_FIELDS;
    const assessmentFields = isNutritionist
      ? NUTRITIONIST_ASSESSMENT_FIELDS
      : EDUCATOR_ASSESSMENT_FIELDS;

    await Promise.all([
      anamneseCount > 0
        ? Promise.resolve()
        : this.templates.create(
            owner,
            STARTER_ANAMNESE_NAME,
            TemplatePurpose.ANAMNESE,
            anamneseFields,
          ),
      assessmentCount > 0
        ? Promise.resolve()
        : this.templates.create(
            owner,
            STARTER_ASSESSMENT_NAME,
            TemplatePurpose.ASSESSMENT,
            assessmentFields,
          ),
    ]);
  }

  private assertValidFields(fields: TemplateFieldInput[]): void {
    if (fields.length === 0) {
      throw new CodedError(EMPTY_FIELDS, 400, 'template_empty');
    }
    for (const field of fields) {
      if (
        field.fieldType === FormFieldType.MULTIPLE_CHOICE &&
        (!field.options || field.options.length === 0)
      ) {
        throw new CodedError(MISSING_OPTIONS, 400, 'missing_options');
      }
    }
  }
}
