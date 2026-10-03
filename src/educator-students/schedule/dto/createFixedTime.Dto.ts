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

export const WORKOUT_LETTER_VALUES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

export class CreateFixedTimeDTO {
  @ApiProperty({
    minimum: 1,
    maximum: 7,
    description: 'ISO weekday: 1 Monday .. 7 Sunday.',
  })
  @IsInt()
  @Min(1)
  @Max(7)
  weekday: number;

  @ApiProperty({
    minimum: 0,
    maximum: 1435,
    description: 'Minutes from midnight in Brasília time, in steps of 5.',
  })
  @IsInt()
  @Min(0)
  @Max(1435)
  startMinute: number;

  @ApiProperty({
    required: false,
    minimum: 15,
    maximum: 240,
    default: 60,
    description: 'Duration in minutes, in steps of 5. Defaults to 60.',
  })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  durationMinutes?: number;

  @ApiProperty({ enum: SessionType })
  @IsEnum(SessionType)
  type: SessionType;

  @ApiProperty({
    required: false,
    maxLength: 500,
    description: 'http or https link; only for online times.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  onlineLink?: string;

  @ApiProperty({
    required: false,
    enum: WORKOUT_LETTER_VALUES,
    description: "Session letter of the student's active workout.",
  })
  @IsOptional()
  @IsIn(WORKOUT_LETTER_VALUES)
  workoutLetter?: string;
}
