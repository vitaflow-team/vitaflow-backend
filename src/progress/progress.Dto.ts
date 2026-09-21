import { ApiProperty } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { BmiClassification } from './bmi.util';

export const DASHBOARD_WEEKS = [4, 8, 12] as const;
export const DEFAULT_DASHBOARD_WEEKS = 8;
export type DashboardWeeks = (typeof DASHBOARD_WEEKS)[number];

export class DashboardQueryDTO {
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    const queryValue = value as unknown;
    return typeof queryValue === 'string' && /^\d+$/.test(queryValue)
      ? Number(queryValue)
      : queryValue;
  })
  @IsIn(DASHBOARD_WEEKS as unknown as number[])
  weeks?: DashboardWeeks;
}

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
  period: { weeks: DashboardWeeks; start: string; end: string };
}
