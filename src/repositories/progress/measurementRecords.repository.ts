import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { MeasurementRecord, Prisma } from '@prisma/client';

export type MeasurementRecordInput = Pick<
  Prisma.MeasurementRecordUncheckedCreateInput,
  'weightKg' | 'heightCm' | 'waistCm' | 'hipCm'
>;

export interface MonthlyWeightPoint {
  userId: string;
  year: number;
  month: number;
  avgWeightKg: number;
}

@Injectable()
export class MeasurementRecordsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    data: MeasurementRecordInput,
  ): Promise<MeasurementRecord> {
    return await this.prisma.measurementRecord.create({
      data: { ...data, userId },
    });
  }

  async findById(id: string): Promise<MeasurementRecord | null> {
    return await this.prisma.measurementRecord.findUnique({ where: { id } });
  }

  async findLatestByUser(userId: string): Promise<MeasurementRecord | null> {
    return await this.prisma.measurementRecord.findFirst({
      where: { userId },
      orderBy: [{ recordedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findRecentByUser(
    userId: string,
    limit: number,
  ): Promise<MeasurementRecord[]> {
    return await this.prisma.measurementRecord.findMany({
      where: { userId },
      orderBy: { recordedAt: 'desc' },
      take: limit,
    });
  }

  async findByUserSince(
    userId: string,
    since: Date,
  ): Promise<MeasurementRecord[]> {
    return await this.prisma.measurementRecord.findMany({
      where: { userId, recordedAt: { gte: since } },
      orderBy: { recordedAt: 'asc' },
    });
  }

  async update(
    id: string,
    data: MeasurementRecordInput,
  ): Promise<MeasurementRecord> {
    return await this.prisma.measurementRecord.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.measurementRecord.delete({ where: { id } });
  }

  // DB-side aggregation (ADR-006): avg weight per (userId, calendar month).
  // Prisma's typed `groupBy` can't group by a computed expression on
  // `recordedAt` (unlike Invoice's literal competenceYear/competenceMonth
  // columns), so this uses a parameterized raw query instead — the database
  // still does 100% of the averaging; the caller only buckets the already-
  // aggregated rows by months-in-care and normalizes them.
  async aggregateByClientAndMonth(
    userIds: string[],
  ): Promise<MonthlyWeightPoint[]> {
    if (userIds.length === 0) return [];
    return await this.prisma.$queryRaw<MonthlyWeightPoint[]>(Prisma.sql`
      SELECT "userId",
             EXTRACT(YEAR FROM "recordedAt")::int AS "year",
             EXTRACT(MONTH FROM "recordedAt")::int AS "month",
             AVG("weightKg")::float AS "avgWeightKg"
      FROM "MeasurementRecord"
      WHERE "userId" IN (${Prisma.join(userIds)})
      GROUP BY "userId", "year", "month"
    `);
  }
}
