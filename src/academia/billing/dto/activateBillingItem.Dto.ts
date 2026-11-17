import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ActivateBillingItemDTO {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @ApiProperty({ required: false, example: 10 })
  @IsOptional()
  dueDay?: unknown;

  @ApiProperty({ required: false, example: 12000 })
  @IsOptional()
  amountCents?: unknown;
}
