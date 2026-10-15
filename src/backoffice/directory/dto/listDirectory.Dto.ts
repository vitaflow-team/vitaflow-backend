import { ApiProperty } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import type { DirectoryTypeFilter } from '../backofficeDirectoryMerge.util';

const TYPE_VALUES: DirectoryTypeFilter[] = [
  'USER',
  'NUTRITIONIST',
  'PHYSICAL_EDUCATOR',
  'ACADEMIA',
];

export class ListDirectoryQueryDTO {
  @ApiProperty({
    required: false,
    description: 'Part of the name or e-mail.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiProperty({ required: false, enum: TYPE_VALUES })
  @IsOptional()
  @IsIn(TYPE_VALUES)
  type?: DirectoryTypeFilter;

  @ApiProperty({ required: false, minimum: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    const raw = value as unknown;
    return typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
  })
  @IsInt()
  @Min(1)
  page?: number;
}
