import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { AccessPlanValidityType, AcademiaAccessPlan } from '@prisma/client';

export interface AccessPlanInput {
  name: string;
  validityType: AccessPlanValidityType;
  validityValue: number;
  referencePrice: number;
}

@Injectable()
export class AcademiaAccessPlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    academiaId: string,
    data: AccessPlanInput,
  ): Promise<AcademiaAccessPlan> {
    return await this.prisma.academiaAccessPlan.create({
      data: { academiaId, ...data },
    });
  }

  async listByAcademia(academiaId: string): Promise<AcademiaAccessPlan[]> {
    return await this.prisma.academiaAccessPlan.findMany({
      where: { academiaId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(
    id: string,
    academiaId: string,
  ): Promise<AcademiaAccessPlan | null> {
    return await this.prisma.academiaAccessPlan.findFirst({
      where: { id, academiaId },
    });
  }

  async update(
    id: string,
    academiaId: string,
    data: Partial<AccessPlanInput>,
  ): Promise<boolean> {
    const { count } = await this.prisma.academiaAccessPlan.updateMany({
      where: { id, academiaId },
      data,
    });
    return count === 1;
  }

  async deactivate(id: string, academiaId: string): Promise<boolean> {
    const { count } = await this.prisma.academiaAccessPlan.updateMany({
      where: { id, academiaId },
      data: { active: false },
    });
    return count === 1;
  }
}
