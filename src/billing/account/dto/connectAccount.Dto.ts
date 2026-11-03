import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ConnectAccountDTO {
  @ApiProperty({
    description: 'Chave de API da sua conta Asaas. Armazenada criptografada.',
  })
  @IsString()
  apiKey!: string;
}
