import { ApiProperty } from '@nestjs/swagger';
import { ExerciseEquipment } from '@prisma/client';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ExerciseFilterDto {
  @ApiProperty({
    description: 'Muscle group to filter by (case-insensitive).',
    required: false,
    example: 'Peito',
  })
  @IsOptional()
  @IsString()
  muscleGroup?: string;

  @ApiProperty({
    description: 'Equipment or training location to filter by.',
    enum: ExerciseEquipment,
    required: false,
  })
  @IsOptional()
  @IsEnum(ExerciseEquipment)
  equipment?: ExerciseEquipment;

  @ApiProperty({
    description: 'Case-insensitive substring of the exercise name.',
    required: false,
    example: 'supino',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiProperty({
    description: 'Page number, starting at 1. Each page holds 50 exercises.',
    required: false,
    example: 1,
  })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    const queryValue = value as unknown;
    return typeof queryValue === 'string' && /^\d+$/.test(queryValue)
      ? Number(queryValue)
      : queryValue;
  })
  @IsInt()
  @Min(1)
  page?: number;
}
