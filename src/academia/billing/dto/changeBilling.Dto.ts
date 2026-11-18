import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

export class ChangeBillingDTO {
  @ApiProperty({ required: false, example: 20 })
  @IsOptional()
  dueDay?: unknown;

  @ApiProperty({ required: false, example: 12000 })
  @IsOptional()
  amountCents?: unknown;
}
