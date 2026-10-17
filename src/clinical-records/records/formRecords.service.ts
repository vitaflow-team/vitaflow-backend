import { CodedError } from '@/common/errors/codedError';
import { ConsentService } from '@/common/consent/consent.service';
import {
  AssessmentTemplatesRepository,
  TemplateWithFields,
} from '@/repositories/clinical-records/assessmentTemplates.repository';
import { TemplateResponseDTO } from '../templates/dto/templateResponse.Dto';
import { toTemplateResponse } from '../templates/templates.service';
import {
  FormRecordsRepository,
  FormRecordValueInput,
  FormRecordWithValues,
} from '@/repositories/clinical-records/formRecords.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { Injectable } from '@nestjs/common';
import { ConsentFeature, Prisma, TemplatePurpose } from '@prisma/client';
import { calculateBmi, classifyBmi } from '@/progress/bmi.util';
import { assertCanRecordFormAgainstClient } from '../clinicalRecordsAuthorization.util';
import { CreateFormRecordDTO } from './dto/createFormRecord.Dto';
import {
  BmiResponseDTO,
  FormRecordResponseDTO,
} from './dto/formRecordResponse.Dto';
import { FormRecordValueInputDTO } from './dto/formRecordValueInput.Dto';
import { UpdateFormRecordDTO } from './dto/updateFormRecord.Dto';

const CLIENT_NOT_FOUND = 'Paciente/aluno não encontrado.';
const TEMPLATE_NOT_FOUND = 'Modelo não encontrado.';
const RECORD_NOT_FOUND = 'Registro não encontrado.';
const REQUIRED_FIELD_MISSING = 'Preencha todos os campos obrigatórios.';
const IMPLAUSIBLE_VALUE = 'Valor fora do intervalo plausível.';
const INVALID_OPTION = 'Opção inválida para este campo.';
const DECLARATION_REQUIRED =
  'Aceite a declaração de responsabilidade sobre dados de saúde antes de registrar o primeiro prontuário.';

// The health-record consent gate (ADR-011, generalized from the physical
// educator's own one-time declaration): scoped per professional/caller — the
// same FeatureConsent row (no studentId column) covers every patient/student
// once accepted, exactly like the mechanism it replaces.
const DECLARATION_FEATURE: ConsentFeature =
  ConsentFeature.HEALTH_RECORD_FILLING;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

export function toFormRecordResponse(
  record: FormRecordWithValues,
): FormRecordResponseDTO {
  return {
    id: record.id,
    recordedAt: record.recordedAt.toISOString(),
    recordedByUserId: record.recordedByUserId,
    values: record.values.map((value) => ({
      fieldLabel: value.fieldLabel,
      fieldType: value.fieldType,
      value:
        value.textValue ??
        value.numberValue ??
        value.boolValue ??
        value.selectedOption ??
        null,
      weightRole: value.weightRole,
      heightRole: value.heightRole,
    })),
    bmi: deriveBmi(record.values),
  };
}

// Only the first weight-tagged and first height-tagged value (by position)
// are used (UT-022); a non-positive value is treated as not-computable, not
// an error (UT-021) — the write-time plausibility check (rejecting negative
// numbers) is a separate, earlier gate.
function deriveBmi(
  values: FormRecordWithValues['values'],
): BmiResponseDTO | null {
  const weight = values.find((v) => v.weightRole && v.numberValue !== null);
  const height = values.find((v) => v.heightRole && v.numberValue !== null);
  if (!weight || !height) return null;
  if (weight.numberValue! <= 0 || height.numberValue! <= 0) return null;

  const bmi = calculateBmi(weight.numberValue!, height.numberValue);
  const classification = classifyBmi(bmi);
  if (bmi === null || classification === null) return null;
  return { value: bmi, classification };
}

@Injectable()
export class FormRecordsService {
  constructor(
    private readonly records: FormRecordsRepository,
    private readonly templates: AssessmentTemplatesRepository,
    private readonly clients: ClientsRepository,
    private readonly employments: EmploymentRepository,
    private readonly consent: ConsentService,
  ) {}

  async create(
    callerUserId: string,
    callerAcademiaId: string | undefined,
    clientId: string,
    dto: CreateFormRecordDTO,
  ): Promise<FormRecordResponseDTO> {
    const client = await this.findClient(clientId);
    await assertCanRecordFormAgainstClient(
      this.employments,
      client,
      callerUserId,
      callerAcademiaId,
    );
    await this.ensureDeclaration(callerUserId, dto.acceptDeclaration === true);

    const template = await this.findTemplate(dto.templateId);
    const values = this.resolveValues(template, dto.values);
    const recordedAt = dto.recordedAt ? new Date(dto.recordedAt) : new Date();

    const created = await this.records.create(
      client.id,
      template.id,
      callerUserId,
      recordedAt,
      values,
    );
    return toFormRecordResponse(created);
  }

  async update(
    callerUserId: string,
    callerAcademiaId: string | undefined,
    clientId: string,
    recordId: string,
    dto: UpdateFormRecordDTO,
  ): Promise<FormRecordResponseDTO> {
    const client = await this.findClient(clientId);
    await assertCanRecordFormAgainstClient(
      this.employments,
      client,
      callerUserId,
      callerAcademiaId,
    );

    const record = await this.records.findOwned(recordId, client.id);
    if (!record) {
      throw new CodedError(RECORD_NOT_FOUND, 404, 'form_record_not_found');
    }

    const template = await this.findTemplate(record.templateId);
    const values = this.resolveValues(template, dto.values);
    const updated = await this.records.updateValues(record.id, values);
    return toFormRecordResponse(updated);
  }

  async findHistory(
    callerUserId: string,
    callerAcademiaId: string | undefined,
    clientId: string,
    purpose: TemplatePurpose,
  ): Promise<FormRecordResponseDTO[]> {
    const client = await this.findClient(clientId);
    await assertCanRecordFormAgainstClient(
      this.employments,
      client,
      callerUserId,
      callerAcademiaId,
    );

    const history = await this.records.findHistory(client.id, purpose);
    return history.map(toFormRecordResponse);
  }

  // An employed (non-owner) educator has no standing access to the academia's
  // `/academia/templates` management route (owner/manager-only) but still
  // needs to discover which templates exist before filling a record — this
  // ties that discovery to "I'm authorized against this specific client"
  // (ADR-012), the same authorization every other academia read/write here
  // already uses, rather than inventing a separate employment-wide check.
  async listTemplatesForClient(
    callerUserId: string,
    callerAcademiaId: string | undefined,
    clientId: string,
    purpose?: TemplatePurpose,
  ): Promise<TemplateResponseDTO[]> {
    const client = await this.findClient(clientId);
    await assertCanRecordFormAgainstClient(
      this.employments,
      client,
      callerUserId,
      callerAcademiaId,
    );

    const owner = client.academiaId
      ? { academiaId: client.academiaId }
      : { professionalId: client.professionalId! };
    const templates = await this.templates.listByOwner(owner, purpose);
    return templates.map(toTemplateResponse);
  }

  private async findClient(clientId: string) {
    const client = await this.clients.getClientById(clientId);
    if (!client) {
      throw new CodedError(CLIENT_NOT_FOUND, 404, 'client_not_found');
    }
    return client;
  }

  private async findTemplate(templateId: string): Promise<TemplateWithFields> {
    const template = await this.templates.findById(templateId);
    if (!template) {
      throw new CodedError(TEMPLATE_NOT_FOUND, 404, 'template_not_found');
    }
    return template;
  }

  // Snapshots every field's current shape onto a FormRecordValue row, one
  // per field, including unanswered optional ones (ADR-010) — a record's
  // rendering never joins back to TemplateField again.
  private resolveValues(
    template: TemplateWithFields,
    inputs: FormRecordValueInputDTO[],
  ): FormRecordValueInput[] {
    const byFieldId = new Map(
      inputs.map((input) => [input.templateFieldId, input]),
    );

    return template.fields.map((field) => {
      const input = byFieldId.get(field.id);

      if (input === undefined || input.value === undefined) {
        if (field.required) {
          throw new CodedError(
            REQUIRED_FIELD_MISSING,
            400,
            'required_field_missing',
          );
        }
        return {
          fieldLabel: field.label,
          fieldType: field.fieldType,
          position: field.position,
          weightRole: field.weightRole,
          heightRole: field.heightRole,
        };
      }

      return {
        fieldLabel: field.label,
        fieldType: field.fieldType,
        position: field.position,
        weightRole: field.weightRole,
        heightRole: field.heightRole,
        ...this.toValueColumns(field, input.value),
      };
    });
  }

  private toValueColumns(
    field: TemplateWithFields['fields'][number],
    value: string | number | boolean,
  ): Pick<
    FormRecordValueInput,
    'textValue' | 'numberValue' | 'boolValue' | 'selectedOption'
  > {
    switch (field.fieldType) {
      case 'SHORT_TEXT':
      case 'LONG_TEXT':
        return { textValue: String(value) };
      case 'NUMBER': {
        const numberValue = Number(value);
        if (numberValue < 0) {
          throw new CodedError(IMPLAUSIBLE_VALUE, 400, 'implausible_value');
        }
        return { numberValue };
      }
      case 'YES_NO':
        return { boolValue: Boolean(value) };
      case 'MULTIPLE_CHOICE': {
        const selected = String(value);
        if (!field.options.includes(selected)) {
          throw new CodedError(INVALID_OPTION, 400, 'invalid_option');
        }
        return { selectedOption: selected };
      }
      default:
        return {};
    }
  }

  private async ensureDeclaration(
    callerUserId: string,
    acceptNow: boolean,
  ): Promise<void> {
    if (await this.consent.hasConsented(callerUserId, DECLARATION_FEATURE)) {
      return;
    }
    if (!acceptNow) {
      throw new CodedError(DECLARATION_REQUIRED, 403, 'declaration_required');
    }

    try {
      await this.consent.giveConsent(callerUserId, DECLARATION_FEATURE);
    } catch (error) {
      // Accepted from another tab at the same moment: already on record.
      if (!isUniqueViolation(error)) throw error;
    }
  }
}
