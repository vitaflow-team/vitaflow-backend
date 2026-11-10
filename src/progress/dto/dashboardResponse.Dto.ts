import { ApiProperty } from '@nestjs/swagger';
import { AdherenceSummaryDTO } from './adherenceSummary.Dto';
import { BmiPointDTO } from './bmiPoint.Dto';
import { CorrelationPointDTO } from './correlationPoint.Dto';
import { DashboardPeriodDTO } from './dashboardPeriod.Dto';
import { MeasurementRecordResponseDTO } from './measurementRecordResponse.Dto';
import { PeriodComparisonMetricDTO } from './periodComparisonMetric.Dto';
import { StreakSummaryDTO } from './streakSummary.Dto';
import { TrendPointDTO } from './trendPoint.Dto';
import { WeightPointDTO } from './weightPoint.Dto';

export class DashboardResponseDTO {
  @ApiProperty({ type: MeasurementRecordResponseDTO, nullable: true })
  latest: MeasurementRecordResponseDTO | null;

  @ApiProperty({ example: -0.5, nullable: true, type: Number })
  weightVariationKg: number | null;

  @ApiProperty({ type: [WeightPointDTO] })
  weightSeries: WeightPointDTO[];

  @ApiProperty({ type: [BmiPointDTO] })
  bmiSeries: BmiPointDTO[];

  @ApiProperty({ type: [MeasurementRecordResponseDTO] })
  history: MeasurementRecordResponseDTO[];

  @ApiProperty({ type: DashboardPeriodDTO })
  period: DashboardPeriodDTO;

  @ApiProperty({ type: [TrendPointDTO] })
  smoothedTrend: TrendPointDTO[];

  @ApiProperty({ type: [PeriodComparisonMetricDTO] })
  periodComparison: PeriodComparisonMetricDTO[];

  @ApiProperty({ type: StreakSummaryDTO })
  streak: StreakSummaryDTO;

  @ApiProperty({ type: AdherenceSummaryDTO })
  adherence: AdherenceSummaryDTO;

  @ApiProperty({ type: [CorrelationPointDTO] })
  correlation: CorrelationPointDTO[];
}
