import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class DateQueryDto {
  @ApiProperty({ example: '2026-09-30', description: 'YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date: string;
}
