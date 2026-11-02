import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';

// Shape-only validation here; the business rules (amount range, due-date
// window, competence window, CPF/CNPJ check digits) live in the shared
// billing validators the service calls, the same split ConnectAccountDTO
// already established for the API key.
export class CreateInvoiceDTO {
  @ApiProperty({ example: 2026 })
  @IsInt()
  competenceYear!: number;

  @ApiProperty({ example: 11, minimum: 1, maximum: 12 })
  @IsInt()
  competenceMonth!: number;

  @ApiProperty({ example: '199.90', description: 'Valor em reais.' })
  @IsString()
  amount!: string;

  @ApiProperty({ example: '2026-11-20' })
  @IsString()
  dueDate!: string;

  @ApiProperty({
    required: false,
    description: 'CPF ou CNPJ do aluno, exigido apenas na primeira cobrança.',
  })
  @IsOptional()
  @IsString()
  cpfCnpj?: string;
}
