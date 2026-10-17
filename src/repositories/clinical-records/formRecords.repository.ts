import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import {
  FormFieldType,
  FormRecord,
  FormRecordValue,
  Prisma,
  TemplatePurpose,
} from '@prisma/client';

export type FormRecordWithValues = FormRecord & { values: FormRecordValue[] };

export type FormRecordWithRecorder = FormRecordWithValues & {
  client: { professional: { id: string; name: string } | null };
};

export interface FormRecordValueInput {
  fieldLabel: string;
  fieldType: FormFieldType;
  position: number;
  weightRole: boolean;
  heightRole: boolean;
  textValue?: string | null;
  numberValue?: number | null;
  boolValue?: boolean | null;
  selectedOption?: string | null;
}

const NEWEST_FIRST: Prisma.FormRecordOrderByWithRelationInput[] = [
  { recordedAt: 'desc' },
  { createdAt: 'desc' },
];

function valuesCreateInput(
  values: FormRecordValueInput[],
): Prisma.FormRecordValueCreateWithoutRecordInput[] {
  return values.map((value) => ({
    position: value.position,
    fieldLabel: value.fieldLabel,
    fieldType: value.fieldType,
    weightRole: value.weightRole,
    heightRole: value.heightRole,
    textValue: value.textValue ?? null,
    numberValue: value.numberValue ?? null,
    boolValue: value.boolValue ?? null,
    selectedOption: value.selectedOption ?? null,
  }));
}

@Injectable()
export class FormRecordsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    clientId: string,
    templateId: string,
    recordedByUserId: string,
    recordedAt: Date,
    values: FormRecordValueInput[],
  ): Promise<FormRecordWithValues> {
    return await this.prisma.formRecord.create({
      data: {
        clientId,
        templateId,
        recordedByUserId,
        recordedAt,
        values: { create: valuesCreateInput(values) },
      },
      include: { values: { orderBy: { position: 'asc' } } },
    });
  }

  async findOwned(
    id: string,
    clientId: string,
  ): Promise<FormRecordWithValues | null> {
    return await this.prisma.formRecord.findFirst({
      where: { id, clientId },
      include: { values: { orderBy: { position: 'asc' } } },
    });
  }

  // Replaces the whole value set in place — the same record, not a new one
  // (US-008): a revision keeps its id and recordedAt, only the answers change.
  async updateValues(
    id: string,
    values: FormRecordValueInput[],
  ): Promise<FormRecordWithValues> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.formRecordValue.deleteMany({ where: { recordId: id } });
      return await tx.formRecord.update({
        where: { id },
        data: { values: { create: valuesCreateInput(values) } },
        include: { values: { orderBy: { position: 'asc' } } },
      });
    });
  }

  async findHistory(
    clientId: string,
    purpose: TemplatePurpose,
  ): Promise<FormRecordWithValues[]> {
    return await this.prisma.formRecord.findMany({
      where: { clientId, template: { purpose } },
      include: { values: { orderBy: { position: 'asc' } } },
      orderBy: NEWEST_FIRST,
    });
  }

  async findLatestByClient(
    clientId: string,
    purpose: TemplatePurpose,
    limit: number,
  ): Promise<FormRecordWithValues[]> {
    return await this.prisma.formRecord.findMany({
      where: { clientId, template: { purpose } },
      include: { values: { orderBy: { position: 'asc' } } },
      orderBy: NEWEST_FIRST,
      take: limit,
    });
  }

  // Every weight-tagged, height-tagged record of every linked professional
  // (any product type, any ownership), for the Progress Dashboard merge
  // (ADR-011) — the generalization of PhysicalAssessmentsRepository's
  // `findRecentByLinkedUser`.
  async findWeightPointsByLinkedUser(
    userId: string,
    limit: number,
    since?: Date,
  ): Promise<FormRecordWithRecorder[]> {
    return await this.prisma.formRecord.findMany({
      where: {
        client: { userId },
        values: { some: { weightRole: true, numberValue: { not: null } } },
        ...(since ? { recordedAt: { gte: since } } : {}),
      },
      include: {
        values: { orderBy: { position: 'asc' } },
        client: {
          select: { professional: { select: { id: true, name: true } } },
        },
      },
      orderBy: NEWEST_FIRST,
      take: limit,
    });
  }
}
