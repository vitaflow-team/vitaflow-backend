import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import {
  AssessmentTemplate,
  FormFieldType,
  Prisma,
  TemplateField,
  TemplatePurpose,
} from '@prisma/client';

export type TemplateWithFields = AssessmentTemplate & {
  fields: TemplateField[];
};

export interface TemplateFieldInput {
  label: string;
  fieldType: FormFieldType;
  options?: string[];
  required?: boolean;
  weightRole?: boolean;
  heightRole?: boolean;
}

export type TemplateOwner =
  | { professionalId: string; academiaId?: undefined }
  | { academiaId: string; professionalId?: undefined };

const ORDER_BY_NAME: Prisma.AssessmentTemplateOrderByWithRelationInput = {
  name: 'asc',
};

@Injectable()
export class AssessmentTemplatesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    owner: TemplateOwner,
    name: string,
    purpose: TemplatePurpose,
    fields: TemplateFieldInput[],
  ): Promise<TemplateWithFields> {
    return await this.prisma.assessmentTemplate.create({
      data: {
        ...owner,
        name,
        purpose,
        fields: {
          create: fields.map((field, position) => ({
            position,
            label: field.label,
            fieldType: field.fieldType,
            options: field.options ?? [],
            required: field.required ?? false,
            weightRole: field.weightRole ?? false,
            heightRole: field.heightRole ?? false,
          })),
        },
      },
      include: { fields: { orderBy: { position: 'asc' } } },
    });
  }

  async findById(id: string): Promise<TemplateWithFields | null> {
    return await this.prisma.assessmentTemplate.findUnique({
      where: { id },
      include: { fields: { orderBy: { position: 'asc' } } },
    });
  }

  // Scoped to the owner, so a foreign template id resolves to null exactly
  // like a missing one (the findOwnedById pattern, applied to templates).
  async findOwnedById(
    id: string,
    owner: TemplateOwner,
  ): Promise<TemplateWithFields | null> {
    return await this.prisma.assessmentTemplate.findFirst({
      where: { id, ...owner },
      include: { fields: { orderBy: { position: 'asc' } } },
    });
  }

  async listByOwner(
    owner: TemplateOwner,
    purpose?: TemplatePurpose,
    includeInactive = false,
  ): Promise<TemplateWithFields[]> {
    return await this.prisma.assessmentTemplate.findMany({
      where: {
        ...owner,
        ...(purpose ? { purpose } : {}),
        ...(includeInactive ? {} : { active: true }),
      },
      include: { fields: { orderBy: { position: 'asc' } } },
      orderBy: ORDER_BY_NAME,
    });
  }

  async countByOwner(
    owner: TemplateOwner,
    purpose: TemplatePurpose,
  ): Promise<number> {
    return await this.prisma.assessmentTemplate.count({
      where: { ...owner, purpose },
    });
  }

  // Replaces the whole field list: simplest correct behavior for "fields
  // never retroactively change past records" (US-004), since FormRecordValue
  // never dereferences TemplateField again after a record is created —
  // deleting and recreating field rows here has no effect on any existing
  // FormRecord.
  async update(
    id: string,
    owner: TemplateOwner,
    patch: { name?: string; fields?: TemplateFieldInput[] },
  ): Promise<TemplateWithFields | null> {
    const existing = await this.findOwnedById(id, owner);
    if (!existing) return null;

    return await this.prisma.$transaction(async (tx) => {
      if (patch.fields) {
        await tx.templateField.deleteMany({ where: { templateId: id } });
      }
      return await tx.assessmentTemplate.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.fields
            ? {
                fields: {
                  create: patch.fields.map((field, position) => ({
                    position,
                    label: field.label,
                    fieldType: field.fieldType,
                    options: field.options ?? [],
                    required: field.required ?? false,
                    weightRole: field.weightRole ?? false,
                    heightRole: field.heightRole ?? false,
                  })),
                },
              }
            : {}),
        },
        include: { fields: { orderBy: { position: 'asc' } } },
      });
    });
  }

  async discontinue(
    id: string,
    owner: TemplateOwner,
  ): Promise<TemplateWithFields | null> {
    const existing = await this.findOwnedById(id, owner);
    if (!existing) return null;

    return await this.prisma.assessmentTemplate.update({
      where: { id },
      data: { active: false },
      include: { fields: { orderBy: { position: 'asc' } } },
    });
  }
}
