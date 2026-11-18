import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class SetDiaryReminderDto {
  @ApiProperty({
    example: '19:00',
    description: 'HH:mm in Brasília time, a multiple of 15 minutes.',
  })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  time: string;
}
