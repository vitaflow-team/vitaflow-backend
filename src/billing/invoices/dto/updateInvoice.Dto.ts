import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateInvoiceDTO {
  @ApiProperty({
    required: false,
    example: '199.90',
    description: 'Valor em reais.',
  })
  @IsOptional()
  @IsString()
  amount?: string;

  @ApiProperty({ required: false, example: '2026-11-25' })
  @IsOptional()
  @IsString()
  dueDate?: string;
}
