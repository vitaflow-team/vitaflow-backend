import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class MarkPaidDTO {
  @ApiProperty({ example: '2026-11-18', description: 'Data do pagamento.' })
  @IsString()
  paidOn!: string;

  @ApiProperty({
    required: false,
    example: 'Pago em dinheiro na academia.',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  note?: string;
}
