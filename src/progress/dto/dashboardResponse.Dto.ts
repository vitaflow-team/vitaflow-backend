import { ApiProperty } from '@nestjs/swagger';
import { BmiPointDTO } from './bmiPoint.Dto';
import { DashboardPeriodDTO } from './dashboardPeriod.Dto';
import { MeasurementRecordResponseDTO } from './measurementRecordResponse.Dto';
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
}
