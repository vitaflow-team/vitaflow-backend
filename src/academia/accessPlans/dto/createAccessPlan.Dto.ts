import { ApiProperty } from '@nestjs/swagger';
import { AccessPlanValidityType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class CreateAccessPlanDTO {
  @ApiProperty({ example: 'Mensal' })
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank.' })
  name: string;

  @ApiProperty({ enum: AccessPlanValidityType })
  @IsEnum(AccessPlanValidityType)
  validityType: AccessPlanValidityType;

  @ApiProperty({
    example: 30,
    description: 'Number of days or number of visits, per validityType.',
  })
  @IsInt()
  @IsPositive()
  validityValue: number;

  @ApiProperty({
    example: 129.9,
    description:
      "Reference price for the gym's own bookkeeping only — VitaFlow never charges this amount to anyone (gym-foundation ADR-006).",
  })
  @IsNumber()
  @Min(0)
  referencePrice: number;
}
