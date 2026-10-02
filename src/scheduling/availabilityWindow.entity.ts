import { ApiProperty } from '@nestjs/swagger';

export class AvailabilityWindowEntity {
  @ApiProperty()
  id: string;

  @ApiProperty()
  professionalId: string;

  @ApiProperty({ description: '1 (Monday) through 7 (Sunday), ISO 8601.' })
  dayOfWeek: number;

  @ApiProperty({ description: 'Minutes from midnight, BRT.' })
  startMinute: number;

  @ApiProperty({ description: 'Minutes from midnight, BRT.' })
  endMinute: number;

  @ApiProperty()
  sessionDurationMinutes: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
