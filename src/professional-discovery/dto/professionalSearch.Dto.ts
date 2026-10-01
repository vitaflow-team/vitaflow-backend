import { ApiProperty } from '@nestjs/swagger';
import { ProductType } from '@prisma/client';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

const PROFESSIONAL_TYPES = [
  ProductType.NUTRITIONIST,
  ProductType.PHYSICAL_EDUCATOR,
] as const;

export class ProfessionalSearchDto {
  @ApiProperty({
    description: 'Restrict to one professional type.',
    enum: PROFESSIONAL_TYPES,
    required: false,
  })
  @IsOptional()
  @IsEnum(PROFESSIONAL_TYPES)
  type?: ProductType;

  // Matches name OR specialty text, case-insensitively (US-001.AC-2) — the
  // TechSpec's single `specialty` query param doubles as the general search
  // term the user story describes.
  @ApiProperty({
    description:
      "Search term matched against the professional's name or specialty, case-insensitively.",
    required: false,
    example: 'nutrição esportiva',
  })
  @IsOptional()
  @IsString()
  specialty?: string;

  @ApiProperty({
    description: 'Maximum starting price.',
    required: false,
    example: 200,
  })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    const queryValue = value as unknown;
    return typeof queryValue === 'string' && /^\d+(\.\d+)?$/.test(queryValue)
      ? Number(queryValue)
      : queryValue;
  })
  @IsNumber()
  @Min(0)
  priceMax?: number;

  @ApiProperty({
    description: 'Only professionals who attend online.',
    required: false,
    example: true,
  })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value as unknown;
  })
  @IsBoolean()
  online?: boolean;
}
