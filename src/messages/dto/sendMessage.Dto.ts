import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_MESSAGE_LENGTH } from '../messages.constants';

export class SendMessageDto {
  @ApiProperty({
    description: 'Plain text content.',
    example: 'Oi, tudo bem?',
    maxLength: MAX_MESSAGE_LENGTH,
  })
  @IsString()
  @IsNotEmpty({ message: 'A mensagem não pode estar vazia.' })
  @MaxLength(MAX_MESSAGE_LENGTH, {
    message: `A mensagem pode ter no máximo ${MAX_MESSAGE_LENGTH} caracteres.`,
  })
  content: string;
}
