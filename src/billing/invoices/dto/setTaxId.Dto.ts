import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class SetTaxIdDTO {
  @ApiProperty({ example: '529.982.247-25', description: 'CPF ou CNPJ.' })
  @IsString()
  cpfCnpj!: string;
}
