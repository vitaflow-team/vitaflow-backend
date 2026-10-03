import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { PhysicalAssessment, Prisma } from '@prisma/client';

export type AssessmentInput = Omit<
  Prisma.PhysicalAssessmentUncheckedCreateInput,
  'id' | 'clientId' | 'createdAt' | 'updatedAt'
>;

export type AssessmentForVariation = Pick<
  PhysicalAssessment,
  'assessedOn' | 'createdAt' | 'weightKg' | 'bodyFatPercent'
>;

export type AssessmentWithEducator = PhysicalAssessment & {
  client: { professional: { id: string; name: string } };
};

const NEWEST_FIRST: Prisma.PhysicalAssessmentOrderByWithRelationInput[] = [
  { assessedOn: 'desc' },
  { createdAt: 'desc' },
];

@Injectable()
export class PhysicalAssessmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    clientId: string,
    data: AssessmentInput,
  ): Promise<PhysicalAssessment> {
    return await this.prisma.physicalAssessment.create({
      data: { ...data, clientId },
    });
  }

  // Scoped to the student so an id of another student's assessment never
  // resolves here.
  async findOwned(
    id: string,
    clientId: string,
  ): Promise<PhysicalAssessment | null> {
    return await this.prisma.physicalAssessment.findFirst({
      where: { id, clientId },
    });
  }

  async listByClient(
    clientId: string,
    skip: number,
    take: number,
  ): Promise<{ items: PhysicalAssessment[]; total: number }> {
    const [items, total] = await Promise.all([
      this.prisma.physicalAssessment.findMany({
        where: { clientId },
        orderBy: NEWEST_FIRST,
        skip,
        take,
      }),
      this.prisma.physicalAssessment.count({ where: { clientId } }),
    ]);
    return { items, total };
  }

  async findAllForVariation(
    clientId: string,
  ): Promise<AssessmentForVariation[]> {
    return await this.prisma.physicalAssessment.findMany({
      where: { clientId },
      select: {
        assessedOn: true,
        createdAt: true,
        weightKg: true,
        bodyFatPercent: true,
      },
    });
  }

  async findLatestByClient(
    clientId: string,
    limit: number,
  ): Promise<PhysicalAssessment[]> {
    return await this.prisma.physicalAssessment.findMany({
      where: { clientId },
      orderBy: NEWEST_FIRST,
      take: limit,
    });
  }

  // Every assessment of every student record linked to this account, with the
  // educator who made it — what the student's own screens read.
  async findRecentByLinkedUser(
    userId: string,
    limit: number,
    since?: Date,
  ): Promise<AssessmentWithEducator[]> {
    return await this.prisma.physicalAssessment.findMany({
      where: {
        client: { userId },
        ...(since ? { assessedOn: { gte: since } } : {}),
      },
      include: {
        client: {
          select: { professional: { select: { id: true, name: true } } },
        },
      },
      orderBy: NEWEST_FIRST,
      take: limit,
    });
  }

  async update(id: string, data: AssessmentInput): Promise<PhysicalAssessment> {
    return await this.prisma.physicalAssessment.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.physicalAssessment.delete({ where: { id } });
  }
}
