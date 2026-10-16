import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ManualEnrollTurmaDTO {
  @ApiProperty({ description: 'Aluno desta academia a inscrever.' })
  @IsString()
  @IsNotEmpty()
  clientId: string;
}
