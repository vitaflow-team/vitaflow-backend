import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { BmiClassification } from './bmi.util';

export class CreateMeasurementRecordDTO {
  @ApiProperty({ example: 70.5, minimum: 20, maximum: 300 })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(20)
  @Max(300)
  weightKg: number;

  @ApiProperty({ example: 175, minimum: 50, maximum: 250 })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(50)
  @Max(250)
  heightCm: number;

  @ApiProperty({ example: 80, minimum: 30, maximum: 200, required: false })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(30)
  @Max(200)
  @IsOptional()
  waistCm?: number;

  @ApiProperty({ example: 95, minimum: 30, maximum: 200, required: false })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(30)
  @Max(200)
  @IsOptional()
  hipCm?: number;
}

export class UpdateMeasurementRecordDTO extends CreateMeasurementRecordDTO {}

export interface MeasurementRecordResponseDTO {
  id: string;
  weightKg: number;
  heightCm: number;
  waistCm: number | null;
  hipCm: number | null;
  recordedAt: string;
  bmi: number;
  bmiClassification: BmiClassification;
}

export interface DashboardResponseDTO {
  latest: MeasurementRecordResponseDTO | null;
  weightVariationKg: number | null;
  weightSeries: Array<{ recordedAt: string; weightKg: number }>;
  bmiSeries: Array<{ recordedAt: string; bmi: number }>;
  history: MeasurementRecordResponseDTO[];
}
