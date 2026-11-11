import { MealsRepository } from '@/repositories/food-diary/meals.repository';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { FormRecordsRepository } from '@/repositories/clinical-records/formRecords.repository';
import { WorkoutsRepository } from '@/repositories/workouts/workouts.repository';
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
import {
  computeAdherence,
  computeCorrelation,
  computePeriodComparison,
  computeSmoothedTrend,
  computeStreak,
  resolvePreviousMonthStart,
} from './progressDashboardAggregation.util';

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
    private readonly formRecords: FormRecordsRepository,
    private readonly meals: MealsRepository,
    private readonly workouts: WorkoutsRepository,
  ) {}

  // The student's own records and the weight-tagged points of every linked
  // professional (any type, ADR-011), merged on read: one source of truth,
  // nothing copied.
  async getDashboard(
    userId: string,
    weeks: DashboardWeeks = DEFAULT_DASHBOARD_WEEKS,
  ): Promise<DashboardResponseDTO> {
    const now = new Date(Date.now());
    const since = new Date(now.getTime() - weeks * 7 * DAY_IN_MS);
    // Period comparison (US-002) needs the full previous calendar month,
    // which can reach further back than the `weeks` display window.
    const previousMonthStart = resolvePreviousMonthStart(now);
    const widestSince =
      since.getTime() < previousMonthStart.getTime()
        ? since
        : previousMonthStart;

    const [
      ownRecent,
      ownWide,
      professionalRecent,
      professionalWide,
      diaryMeals,
      hasWorkoutPlan,
    ] = await Promise.all([
      this.measurementRecords.findRecentByUser(userId, RECENT_LIMIT),
      this.measurementRecords.findByUserSince(userId, widestSince),
      this.formRecords.findWeightPointsByLinkedUser(userId, RECENT_LIMIT),
      this.formRecords.findWeightPointsByLinkedUser(
        userId,
        PERIOD_LIMIT,
        widestSince,
      ),
      this.meals.findByUserAndDateRange(userId, widestSince, now),
      this.workouts.existsForUser(userId),
    ]);

    const recent = mergeMeasurementPoints(ownRecent, professionalRecent).slice(
      0,
      RECENT_LIMIT,
    );
    const wideMerged = mergeMeasurementPoints(ownWide, professionalWide);
    const withinPeriod = wideMerged
      .filter((point) => point.recordedAt >= since)
      .reverse();

    const diaryLoggedDates = diaryMeals.map((meal) => meal.loggedAt);
    const diaryLoggedDatesInWindow = diaryLoggedDates.filter(
      (date) => date >= since,
    );
    const weightPointsInWindow = withinPeriod.map((point) => ({
      recordedAt: point.recordedAt,
      weightKg: point.weightKg,
    }));
    const weightPointsWide = wideMerged.map((point) => ({
      recordedAt: point.recordedAt,
      weightKg: point.weightKg,
    }));

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
      // A point with no height-tagged value alongside its weight has no
      // computable BMI (ADR-002) — it is simply absent from this series.
      bmiSeries: withinPeriod.flatMap((point) => {
        const bmi = calculateBmi(point.weightKg, point.heightCm);
        return bmi === null
          ? []
          : [
              {
                recordedAt: point.recordedAt.toISOString(),
                bmi,
                ...educatorLabel(point),
              },
            ];
      }),
      history: recent.map((point) => this.toResponse(point)),
      period: {
        weeks,
        start: since.toISOString(),
        end: now.toISOString(),
      },
      smoothedTrend: computeSmoothedTrend(weightPointsInWindow),
      periodComparison: computePeriodComparison(
        weightPointsWide,
        diaryLoggedDates,
        now,
      ),
      streak: computeStreak(diaryLoggedDates, now),
      adherence: computeAdherence(
        diaryLoggedDatesInWindow,
        since,
        now,
        hasWorkoutPlan,
      ),
      correlation: computeCorrelation(
        weightPointsInWindow,
        diaryLoggedDatesInWindow,
      ),
    };
  }

  async getLatest(userId: string): Promise<LatestRecordResponseDTO> {
    const [own, professionalRecords] = await Promise.all([
      this.measurementRecords.findLatestByUser(userId),
      this.formRecords.findWeightPointsByLinkedUser(userId, 1),
    ]);
    const [latest] = mergeMeasurementPoints(
      own ? [own] : [],
      professionalRecords,
    );

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
