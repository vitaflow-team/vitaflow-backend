import { ApiProperty } from '@nestjs/swagger';
import { AccessPlanValidityType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class UpdateAccessPlanDTO {
  @ApiProperty({ required: false, example: 'Mensal' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank.' })
  name?: string;

  @ApiProperty({ required: false, enum: AccessPlanValidityType })
  @IsOptional()
  @IsEnum(AccessPlanValidityType)
  validityType?: AccessPlanValidityType;

  @ApiProperty({ required: false, example: 30 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  validityValue?: number;

  @ApiProperty({ required: false, example: 129.9 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  referencePrice?: number;
}
