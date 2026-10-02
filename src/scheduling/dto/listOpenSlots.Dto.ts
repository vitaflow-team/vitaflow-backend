import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsUUID } from 'class-validator';

export class ListOpenSlotsDto {
  @ApiProperty()
  @IsUUID()
  professionalId: string;

  @ApiProperty({ description: 'ISO 8601 date-time.' })
  @IsDateString()
  from: string;

  @ApiProperty({ description: 'ISO 8601 date-time.' })
  @IsDateString()
  to: string;
}
