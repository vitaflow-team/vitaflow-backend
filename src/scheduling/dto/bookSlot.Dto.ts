import { ApiProperty } from '@nestjs/swagger';
import { SessionType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class BookSlotDto {
  @ApiProperty({ enum: SessionType })
  @IsEnum(SessionType)
  type: SessionType;
}
