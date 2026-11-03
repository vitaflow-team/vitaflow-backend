import { ApiProperty } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class ListStudentsQueryDTO {
  @ApiProperty({
    required: false,
    description: 'Part of the name or e-mail; case and accent insensitive.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiProperty({
    required: false,
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    const raw = value as unknown;
    return typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
  })
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({
    required: false,
    enum: ['next', 'name'],
    default: 'next',
    description: 'next: soonest next session first; name: alphabetical.',
  })
  @IsOptional()
  @IsIn(['next', 'name'])
  order?: 'next' | 'name';

  @ApiProperty({
    required: false,
    description:
      'When true, only students currently pending or overdue (Premium only; ignored otherwise).',
  })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    const raw = value as unknown;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return raw;
  })
  @IsBoolean()
  pending?: boolean;
}
