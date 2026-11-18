import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// Shape-only validation: the due day and amount rules live in the service so
// each failure carries its own code (`invalid_due_day`, `invalid_amount`).
export class BillingTermsDTO {
  @ApiProperty({
    required: false,
    example: 10,
    description:
      'Dia de vencimento de 1 a 28. Padrão: o dia de hoje (máx. 28).',
  })
  @IsOptional()
  dueDay?: unknown;

  @ApiProperty({
    required: false,
    example: 14990,
    description: 'Valor da mensalidade em centavos. Padrão: o preço do plano.',
  })
  @IsOptional()
  amountCents?: unknown;

  @ApiProperty({
    required: false,
    description: 'CPF ou CNPJ do aluno, exigido se ainda não houver um salvo.',
  })
  @IsOptional()
  @IsString()
  cpfCnpj?: string;
}
