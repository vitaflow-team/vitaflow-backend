import { ApiProperty } from '@nestjs/swagger';
import { SessionType } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { WORKOUT_LETTER_VALUES } from './createFixedTime.Dto';

// Every field is optional: only the given values change.
export class UpdateFixedTimeDTO {
  @ApiProperty({ required: false, minimum: 1, maximum: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weekday?: number;

  @ApiProperty({ required: false, minimum: 0, maximum: 1435 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1435)
  startMinute?: number;

  @ApiProperty({ required: false, minimum: 15, maximum: 240 })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  durationMinutes?: number;

  @ApiProperty({ required: false, enum: SessionType })
  @IsOptional()
  @IsEnum(SessionType)
  type?: SessionType;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  onlineLink?: string | null;

  @ApiProperty({ required: false, enum: WORKOUT_LETTER_VALUES, nullable: true })
  @IsOptional()
  @IsIn(WORKOUT_LETTER_VALUES)
  workoutLetter?: string | null;
}
