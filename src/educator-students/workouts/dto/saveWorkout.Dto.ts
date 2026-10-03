import { EducatorExerciseSource, ExerciseEquipment } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { TrimString } from '../../students/dto/createStudent.Dto';
import {
  EXERCISE_LOAD_MAX,
  EXERCISE_REPS_MAX,
  EXERCISE_SETS_MAX,
  EXERCISE_SETS_MIN,
  FREE_EXERCISE_NAME_MAX,
  MUSCLE_GROUPS,
  SESSION_EXERCISES_MAX,
  SESSION_NAME_MAX,
  VIDEO_URL_MAX,
  WORKOUT_SESSIONS_MAX,
} from '../workoutLimits.constants';
import { CreateWorkoutDTO } from './createWorkout.Dto';
import { OptionalVideoUrl, TrimToUndefined } from './workoutValidators';

const isFree = (item: ExerciseItemDTO) =>
  item.source === EducatorExerciseSource.FREE;
const isLibrary = (item: ExerciseItemDTO) =>
  item.source === EducatorExerciseSource.LIBRARY;

export class ExerciseItemDTO {
  @ApiProperty({
    required: false,
    description: 'Id of an item already in this workout; absent for a new one.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ enum: EducatorExerciseSource })
  @IsEnum(EducatorExerciseSource)
  source: EducatorExerciseSource;

  @ApiProperty({
    required: false,
    description: 'An approved library exercise; required for `LIBRARY` items.',
  })
  @ValidateIf(isLibrary)
  @IsUUID()
  exerciseId?: string;

  @ApiProperty({
    required: false,
    maxLength: FREE_EXERCISE_NAME_MAX,
    description:
      'Required for `FREE` items; copied from the library otherwise.',
  })
  @ValidateIf(isFree)
  @TrimString()
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank.' })
  @MaxLength(FREE_EXERCISE_NAME_MAX)
  name?: string;

  @ApiProperty({
    required: false,
    enum: MUSCLE_GROUPS,
    description:
      'Required for `FREE` items; copied from the library otherwise.',
  })
  @ValidateIf(isFree)
  @IsIn(MUSCLE_GROUPS)
  muscleGroup?: string;

  @ApiProperty({ required: false, enum: ExerciseEquipment })
  @IsOptional()
  @IsEnum(ExerciseEquipment)
  equipment?: ExerciseEquipment;

  @ApiProperty({ minimum: EXERCISE_SETS_MIN, maximum: EXERCISE_SETS_MAX })
  @IsInt()
  @Min(EXERCISE_SETS_MIN)
  @Max(EXERCISE_SETS_MAX)
  sets: number;

  @ApiProperty({ maxLength: EXERCISE_REPS_MAX, example: '8-12' })
  @TrimString()
  @IsString()
  @IsNotEmpty({ message: 'reps must not be blank.' })
  @MaxLength(EXERCISE_REPS_MAX)
  reps: string;

  @ApiProperty({
    required: false,
    maxLength: EXERCISE_LOAD_MAX,
    example: '40 kg',
  })
  @IsOptional()
  @TrimToUndefined()
  @IsString()
  @MaxLength(EXERCISE_LOAD_MAX)
  load?: string;

  @ApiProperty({
    required: false,
    maxLength: VIDEO_URL_MAX,
    description: 'External http or https link to a demonstration video.',
  })
  @OptionalVideoUrl()
  videoUrl?: string;
}

export class SessionDTO {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ maxLength: SESSION_NAME_MAX, example: 'Peito e tríceps' })
  @TrimString()
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank.' })
  @MaxLength(SESSION_NAME_MAX)
  name: string;

  @ApiProperty({ type: [ExerciseItemDTO], maxItems: SESSION_EXERCISES_MAX })
  @IsArray()
  @ArrayMaxSize(SESSION_EXERCISES_MAX)
  @ValidateNested({ each: true })
  @Type(() => ExerciseItemDTO)
  exercises: ExerciseItemDTO[];
}

// The whole tree in one request (ADR-008): title, frequency, sessions in
// order, each with its exercises in order. Positions come from array order.
export class SaveWorkoutDTO extends CreateWorkoutDTO {
  @ApiProperty({ type: [SessionDTO], maxItems: WORKOUT_SESSIONS_MAX })
  @IsArray()
  @ArrayMaxSize(WORKOUT_SESSIONS_MAX)
  @ValidateNested({ each: true })
  @Type(() => SessionDTO)
  sessions: SessionDTO[];
}
