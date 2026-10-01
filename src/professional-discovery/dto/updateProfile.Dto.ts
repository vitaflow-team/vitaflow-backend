import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiProperty({
    description:
      'Free-text bio. Rejected if it includes before/after imagery references or an outcome guarantee (ADR-003).',
    required: false,
    example: 'Nutricionista especializada em emagrecimento saudável.',
  })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiProperty({
    description: 'Specialty shown in search and on the profile.',
    required: false,
    example: 'Nutrição esportiva',
  })
  @IsOptional()
  @IsString()
  specialty?: string;

  @ApiProperty({
    description: 'Starting price shown on the profile.',
    required: false,
    example: 150,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceFrom?: number;

  @ApiProperty({
    description: 'Whether this professional attends online.',
    required: false,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  attendsOnline?: boolean;
}
