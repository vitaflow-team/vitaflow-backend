import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class UpdateWorkoutExerciseDto {
  @ApiProperty({ required: false, description: 'Replacement exercise id' })
  @IsOptional()
  @IsUUID()
  exerciseId?: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  sets?: number;

  @ApiProperty({ required: false, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  reps?: number;

  @ApiProperty({
    required: false,
    description: 'Removes this exercise from its day instead of editing it',
  })
  @IsOptional()
  @IsBoolean()
  remove?: boolean;
}
