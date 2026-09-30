import { ApiProperty } from '@nestjs/swagger';
import { FitnessGoal, Sex } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class CompleteProfileDto {
  @ApiProperty({ enum: Sex, required: false })
  @IsOptional()
  @IsEnum(Sex)
  sex?: Sex;

  @ApiProperty({ enum: FitnessGoal, required: false })
  @IsOptional()
  @IsEnum(FitnessGoal)
  goal?: FitnessGoal;

  @ApiProperty({ required: false, minimum: 20, maximum: 300 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(20)
  @Max(300)
  weightKg?: number;

  @ApiProperty({ required: false, minimum: 50, maximum: 250 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(50)
  @Max(250)
  heightCm?: number;
}
