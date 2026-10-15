import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { Employment, EmploymentStatus, Prisma } from '@prisma/client';

export type EmploymentWithEducator = Employment & {
  educator: { id: string; name: string; email: string };
};

@Injectable()
export class EmploymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActive(
    academiaId: string,
    educatorId: string,
  ): Promise<Employment | null> {
    return await this.prisma.employment.findFirst({
      where: { academiaId, educatorId, status: EmploymentStatus.ACTIVE },
    });
  }

  async create(academiaId: string, educatorId: string): Promise<Employment> {
    return await this.prisma.employment.create({
      data: { academiaId, educatorId },
    });
  }

  async listActiveByAcademia(
    academiaId: string,
  ): Promise<EmploymentWithEducator[]> {
    return await this.prisma.employment.findMany({
      where: { academiaId, status: EmploymentStatus.ACTIVE },
      include: {
        educator: { select: { id: true, name: true, email: true } },
      },
      orderBy: { startedAt: 'asc' },
    });
  }

  async listActiveByEducator(
    educatorId: string,
  ): Promise<(Employment & { academia: { id: string; name: string } })[]> {
    return await this.prisma.employment.findMany({
      where: { educatorId, status: EmploymentStatus.ACTIVE },
      include: { academia: { select: { id: true, name: true } } },
      orderBy: { startedAt: 'asc' },
    });
  }

  async findById(id: string): Promise<Employment | null> {
    return await this.prisma.employment.findUnique({ where: { id } });
  }

  async end(academiaId: string, employmentId: string): Promise<boolean> {
    return await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.employment.updateMany({
        where: {
          id: employmentId,
          academiaId,
          status: EmploymentStatus.ACTIVE,
        },
        data: { status: EmploymentStatus.ENDED, endedAt: new Date() },
      });
      if (count === 0) {
        return false;
      }

      const employment = await tx.employment.findUniqueOrThrow({
        where: { id: employmentId },
      });
      await tx.client.updateMany({
        where: {
          academiaId,
          professionalId: employment.educatorId,
        },
        data: { professionalId: null },
      });
      await tx.turma.updateMany({
        where: {
          academiaId,
          professionalId: employment.educatorId,
        },
        data: { professionalId: null },
      });
      return true;
    });
  }

  async countClientsAssigned(
    academiaId: string,
    educatorId: string,
  ): Promise<number> {
    return await this.prisma.client.count({
      where: { academiaId, professionalId: educatorId },
    });
  }
}

export type { Prisma };
