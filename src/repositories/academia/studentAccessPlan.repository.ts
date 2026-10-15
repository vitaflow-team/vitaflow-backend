import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import {
  AccessPlanValidityType,
  StudentAccessPlan,
  StudentAccessPlanStatus,
} from '@prisma/client';

export interface StudentAccessPlanData {
  clientId: string;
  accessPlanId: string;
  validityType: AccessPlanValidityType;
  validityValue: number;
  referencePrice: number;
  expiresAt: Date | null;
}

@Injectable()
export class StudentAccessPlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Always created ARCHIVED: activate() does the only transition to ACTIVE,
  // so the partial unique index is never transiently violated.
  async create(data: StudentAccessPlanData): Promise<StudentAccessPlan> {
    return await this.prisma.studentAccessPlan.create({
      data: {
        client: { connect: { id: data.clientId } },
        accessPlan: { connect: { id: data.accessPlanId } },
        validityType: data.validityType,
        validityValue: data.validityValue,
        referencePrice: data.referencePrice,
        expiresAt: data.expiresAt,
        status: StudentAccessPlanStatus.ARCHIVED,
      },
    });
  }

  // Copies EducatorWorkoutsRepository.activate()'s exact shape (ADR-007):
  // row-lock the Client, early-return false if the target is missing or
  // already ACTIVE, archive every other ACTIVE assignment, activate the
  // target — all in one transaction.
  async activate(
    clientId: string,
    studentAccessPlanId: string,
  ): Promise<boolean> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${clientId} FOR UPDATE`;

      const target = await tx.studentAccessPlan.findFirst({
        where: { id: studentAccessPlanId, clientId },
        select: { status: true },
      });
      if (!target) return false;
      if (target.status === StudentAccessPlanStatus.ACTIVE) return false;

      await tx.studentAccessPlan.updateMany({
        where: {
          clientId,
          status: StudentAccessPlanStatus.ACTIVE,
          id: { not: studentAccessPlanId },
        },
        data: { status: StudentAccessPlanStatus.ARCHIVED },
      });
      await tx.studentAccessPlan.update({
        where: { id: studentAccessPlanId },
        data: { status: StudentAccessPlanStatus.ACTIVE },
      });
      return true;
    });
  }

  async findActiveByClient(
    clientId: string,
  ): Promise<StudentAccessPlan | null> {
    return await this.prisma.studentAccessPlan.findFirst({
      where: { clientId, status: StudentAccessPlanStatus.ACTIVE },
    });
  }

  async findById(id: string): Promise<StudentAccessPlan | null> {
    return await this.prisma.studentAccessPlan.findUnique({ where: { id } });
  }

  /** Raw check-in timestamps of this client since the given instant — the
   * caller buckets them into distinct BRT calendar days (ADR-003). */
  async findCheckInTimestampsSince(
    clientId: string,
    since: Date,
  ): Promise<Date[]> {
    const rows = await this.prisma.checkIn.findMany({
      where: { clientId, createdAt: { gte: since } },
      select: { createdAt: true },
    });
    return rows.map((row) => row.createdAt);
  }
}
