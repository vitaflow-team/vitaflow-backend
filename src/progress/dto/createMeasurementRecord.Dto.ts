import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

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
