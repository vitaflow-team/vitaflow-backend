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

export class ListAcademiaStudentsQueryDTO {
  @ApiProperty({
    required: false,
    description:
      "Part of the student's own name or their assigned educator's name; case and accent insensitive.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiProperty({
    required: false,
    enum: ['COM', 'SEM'],
    description:
      'COM: only students with a next session scheduled. SEM: only students without one (always true for an unassigned student). Omitted: all.',
  })
  @IsOptional()
  @IsIn(['COM', 'SEM'])
  horario?: 'COM' | 'SEM';

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
