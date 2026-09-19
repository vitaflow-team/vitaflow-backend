import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { MeasurementRecord, Prisma } from '@prisma/client';

export type MeasurementRecordInput = Pick<
  Prisma.MeasurementRecordUncheckedCreateInput,
  'weightKg' | 'heightCm' | 'waistCm' | 'hipCm'
>;

@Injectable()
export class MeasurementRecordsRepository {
  constructor(private prisma: PrismaService) {}

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
}
