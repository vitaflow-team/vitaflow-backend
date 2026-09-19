import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { AppError } from '@/utils/app.erro';
import { Injectable } from '@nestjs/common';
import { MeasurementRecord } from '@prisma/client';
import { calculateBmi, classifyBmi } from './bmi.util';
import {
  CreateMeasurementRecordDTO,
  DashboardResponseDTO,
  MeasurementRecordResponseDTO,
  UpdateMeasurementRecordDTO,
} from './progress.Dto';

const EIGHT_WEEKS_IN_MS = 8 * 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class ProgressService {
  constructor(private measurementRecords: MeasurementRecordsRepository) {}

  async getDashboard(userId: string): Promise<DashboardResponseDTO> {
    const recent = await this.measurementRecords.findRecentByUser(userId, 10);
    const since = new Date(Date.now() - EIGHT_WEEKS_IN_MS);
    const withinEightWeeks = await this.measurementRecords.findByUserSince(
      userId,
      since,
    );

    return {
      latest: recent[0] ? this.toResponse(recent[0]) : null,
      weightVariationKg:
        recent.length >= 2
          ? Math.round((recent[0].weightKg - recent[1].weightKg) * 10) / 10
          : null,
      weightSeries: withinEightWeeks.map((record) => ({
        recordedAt: record.recordedAt.toISOString(),
        weightKg: record.weightKg,
      })),
      bmiSeries: withinEightWeeks.map((record) => ({
        recordedAt: record.recordedAt.toISOString(),
        bmi: calculateBmi(record.weightKg, record.heightCm),
      })),
      history: recent.map((record) => this.toResponse(record)),
    };
  }

  async create(
    userId: string,
    dto: CreateMeasurementRecordDTO,
  ): Promise<MeasurementRecordResponseDTO> {
    const record = await this.measurementRecords.create(
      userId,
      this.toInput(dto),
    );
    return this.toResponse(record);
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateMeasurementRecordDTO,
  ): Promise<MeasurementRecordResponseDTO> {
    await this.assertOwnership(id, userId);
    const record = await this.measurementRecords.update(id, this.toInput(dto));
    return this.toResponse(record);
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.assertOwnership(id, userId);
    await this.measurementRecords.delete(id);
  }

  private async assertOwnership(
    id: string,
    userId: string,
  ): Promise<MeasurementRecord> {
    const record = await this.measurementRecords.findById(id);

    if (!record) {
      throw new AppError('Registro não encontrado.', 404);
    }

    if (record.userId !== userId) {
      throw new AppError('Ação não permitida.', 401);
    }

    return record;
  }

  private toResponse(record: MeasurementRecord): MeasurementRecordResponseDTO {
    const bmi = calculateBmi(record.weightKg, record.heightCm);

    return {
      id: record.id,
      weightKg: record.weightKg,
      heightCm: record.heightCm,
      waistCm: record.waistCm,
      hipCm: record.hipCm,
      recordedAt: record.recordedAt.toISOString(),
      bmi,
      bmiClassification: classifyBmi(bmi),
    };
  }

  private toInput(dto: CreateMeasurementRecordDTO) {
    return {
      weightKg: dto.weightKg,
      heightCm: dto.heightCm,
      ...(dto.waistCm === undefined ? {} : { waistCm: dto.waistCm }),
      ...(dto.hipCm === undefined ? {} : { hipCm: dto.hipCm }),
    };
  }
}
