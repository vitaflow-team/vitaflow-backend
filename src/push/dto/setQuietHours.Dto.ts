import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, Matches } from 'class-validator';

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class SetQuietHoursDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ example: '22:00', description: 'HH:mm, Brasília time.' })
  @IsString()
  @Matches(CLOCK_TIME)
  start: string;

  @ApiProperty({ example: '07:00', description: 'HH:mm, Brasília time.' })
  @IsString()
  @Matches(CLOCK_TIME)
  end: string;
}
