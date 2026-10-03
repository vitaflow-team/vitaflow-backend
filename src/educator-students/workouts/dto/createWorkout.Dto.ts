import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TrimString } from '../../students/dto/createStudent.Dto';
import {
  WORKOUT_FREQUENCY_MAX,
  WORKOUT_FREQUENCY_MIN,
  WORKOUT_TITLE_MAX,
} from '../workoutLimits.constants';

export class CreateWorkoutDTO {
  @ApiProperty({
    example: 'Hipertrofia — fase 1',
    maxLength: WORKOUT_TITLE_MAX,
  })
  @TrimString()
  @IsString()
  @IsNotEmpty({ message: 'title must not be blank.' })
  @MaxLength(WORKOUT_TITLE_MAX)
  title: string;

  @ApiProperty({
    required: false,
    nullable: true,
    minimum: WORKOUT_FREQUENCY_MIN,
    maximum: WORKOUT_FREQUENCY_MAX,
    example: 4,
  })
  @IsOptional()
  @IsInt()
  @Min(WORKOUT_FREQUENCY_MIN)
  @Max(WORKOUT_FREQUENCY_MAX)
  weeklyFrequency?: number | null;
}
