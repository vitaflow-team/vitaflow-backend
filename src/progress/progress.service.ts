import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { AppError } from '@/utils/app.erro';
import { Injectable } from '@nestjs/common';
import { MeasurementRecord } from '@prisma/client';
import { calculateBmi, classifyBmi } from './bmi.util';
import { DashboardWeeks, DEFAULT_DASHBOARD_WEEKS } from './dashboardWeeks';
import { CreateMeasurementRecordDTO } from './dto/createMeasurementRecord.Dto';
import { DashboardResponseDTO } from './dto/dashboardResponse.Dto';
import { LatestRecordResponseDTO } from './dto/latestRecordResponse.Dto';
import { MeasurementRecordResponseDTO } from './dto/measurementRecordResponse.Dto';
import { UpdateMeasurementRecordDTO } from './dto/updateMeasurementRecord.Dto';
import {
  MergedPoint,
  mergeMeasurementPoints,
  ownRecordToPoint,
} from './mergeMeasurements.util';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 10;
// Upper bound for the points inside the chart window (12 weeks at most).
const PERIOD_LIMIT = 500;

// A chart point names its educator only when an educator measured it, so the
// series of a user with no educator points is exactly what it was before.
function educatorLabel(point: MergedPoint): { educatorName?: string } {
  return point.source === 'EDUCATOR' && point.educatorName
    ? { educatorName: point.educatorName }
    : {};
}

@Injectable()
export class ProgressService {
  constructor(
    private readonly measurementRecords: MeasurementRecordsRepository,
    private readonly assessments: PhysicalAssessmentsRepository,
  ) {}

  // The student's own records and the points of every linked educator,
  // merged on read: one source of truth, nothing copied (educator points
  // always reflect the educator's current assessment).
  async getDashboard(
    userId: string,
    weeks: DashboardWeeks = DEFAULT_DASHBOARD_WEEKS,
  ): Promise<DashboardResponseDTO> {
    const now = new Date(Date.now());
    const since = new Date(now.getTime() - weeks * 7 * DAY_IN_MS);
    // Assessments are date-only: read one day earlier, then filter by the
    // exact instant each point takes.
    const assessmentsSince = new Date(since.getTime() - DAY_IN_MS);

    const [ownRecent, ownPeriod, assessmentsRecent, assessmentsPeriod] =
      await Promise.all([
        this.measurementRecords.findRecentByUser(userId, RECENT_LIMIT),
        this.measurementRecords.findByUserSince(userId, since),
        this.assessments.findRecentByLinkedUser(userId, RECENT_LIMIT),
        this.assessments.findRecentByLinkedUser(
          userId,
          PERIOD_LIMIT,
          assessmentsSince,
        ),
      ]);

    const recent = mergeMeasurementPoints(ownRecent, assessmentsRecent).slice(
      0,
      RECENT_LIMIT,
    );
    const withinPeriod = mergeMeasurementPoints(ownPeriod, assessmentsPeriod)
      .filter((point) => point.recordedAt >= since)
      .reverse();

    return {
      latest: recent[0] ? this.toResponse(recent[0]) : null,
      weightVariationKg:
        recent.length >= 2
          ? Math.round((recent[0].weightKg - recent[1].weightKg) * 10) / 10
          : null,
      weightSeries: withinPeriod.map((point) => ({
        recordedAt: point.recordedAt.toISOString(),
        weightKg: point.weightKg,
        ...educatorLabel(point),
      })),
      bmiSeries: withinPeriod.map((point) => ({
        recordedAt: point.recordedAt.toISOString(),
        bmi: calculateBmi(point.weightKg, point.heightCm),
        ...educatorLabel(point),
      })),
      history: recent.map((point) => this.toResponse(point)),
      period: {
        weeks,
        start: since.toISOString(),
        end: now.toISOString(),
      },
    };
  }

  async getLatest(userId: string): Promise<LatestRecordResponseDTO> {
    const [own, assessments] = await Promise.all([
      this.measurementRecords.findLatestByUser(userId),
      this.assessments.findRecentByLinkedUser(userId, 1),
    ]);
    const [latest] = mergeMeasurementPoints(own ? [own] : [], assessments);

    return { latest: latest ? this.toResponse(latest) : null };
  }

  async create(
    userId: string,
    dto: CreateMeasurementRecordDTO,
  ): Promise<MeasurementRecordResponseDTO> {
    const record = await this.measurementRecords.create(
      userId,
      this.toInput(dto),
    );
    return this.toResponse(ownRecordToPoint(record));
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateMeasurementRecordDTO,
  ): Promise<MeasurementRecordResponseDTO> {
    await this.assertOwnership(id, userId);
    const record = await this.measurementRecords.update(id, this.toInput(dto));
    return this.toResponse(ownRecordToPoint(record));
  }

  // An assessment id is not a measurement record, so it answers 404 here:
  // educator points can never be changed through the user's own routes.
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

  private toResponse(point: MergedPoint): MeasurementRecordResponseDTO {
    const bmi = calculateBmi(point.weightKg, point.heightCm);

    return {
      id: point.id,
      weightKg: point.weightKg,
      heightCm: point.heightCm,
      waistCm: point.waistCm,
      hipCm: point.hipCm,
      recordedAt: point.recordedAt.toISOString(),
      bmi,
      bmiClassification: classifyBmi(bmi),
      source: point.source,
      readOnly: point.readOnly,
      educatorName: point.educatorName,
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
