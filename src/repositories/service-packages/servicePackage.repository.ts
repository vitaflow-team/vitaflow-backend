import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { ServicePackage } from '@prisma/client';

export interface ServicePackageInput {
  name: string;
  sessionCount: number;
  referencePrice: number;
}

@Injectable()
export class ServicePackageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    professionalId: string,
    data: ServicePackageInput,
  ): Promise<ServicePackage> {
    return await this.prisma.servicePackage.create({
      data: { professionalId, ...data },
    });
  }

  async listByProfessional(professionalId: string): Promise<ServicePackage[]> {
    return await this.prisma.servicePackage.findMany({
      where: { professionalId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(
    id: string,
    professionalId: string,
  ): Promise<ServicePackage | null> {
    return await this.prisma.servicePackage.findFirst({
      where: { id, professionalId },
    });
  }

  async update(
    id: string,
    professionalId: string,
    data: Partial<ServicePackageInput>,
  ): Promise<boolean> {
    const { count } = await this.prisma.servicePackage.updateMany({
      where: { id, professionalId },
      data,
    });
    return count === 1;
  }

  async deactivate(id: string, professionalId: string): Promise<boolean> {
    const { count } = await this.prisma.servicePackage.updateMany({
      where: { id, professionalId },
      data: { active: false },
    });
    return count === 1;
  }
}
