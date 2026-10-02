import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class PublishAvailabilityDto {
  @ApiProperty({ description: '1 (Monday) through 7 (Sunday), ISO 8601.' })
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek: number;

  @ApiProperty({ description: 'Minutes from midnight, BRT.' })
  @IsInt()
  @Min(0)
  @Max(1439)
  startMinute: number;

  @ApiProperty({ description: 'Minutes from midnight, BRT.' })
  @IsInt()
  @Min(0)
  @Max(1439)
  endMinute: number;

  @ApiProperty({ description: 'Length of each generated slot, in minutes.' })
  @IsInt()
  @Min(5)
  @Max(480)
  sessionDurationMinutes: number;
}
