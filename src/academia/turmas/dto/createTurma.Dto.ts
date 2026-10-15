import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateTurmaDTO {
  @ApiProperty({ description: 'Nome da turma.', example: 'Spinning' })
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank.' })
  @MaxLength(100)
  name: string;

  @ApiProperty({
    required: false,
    description:
      'Educador responsável, atualmente empregado por esta academia, ou ausente para "sem responsável".',
  })
  @IsOptional()
  @IsString()
  professionalId?: string;

  @ApiProperty({ description: 'Dia da semana ISO (1 seg .. 7 dom).' })
  @IsInt()
  weekday: number;

  @ApiProperty({
    description:
      'Minuto de início, a partir da meia-noite (horário de Brasília).',
  })
  @IsInt()
  @Min(0)
  startMinute: number;

  @ApiProperty({ description: 'Duração em minutos.' })
  @IsInt()
  @Min(1)
  durationMinutes: number;

  @ApiProperty({ description: 'Número máximo de alunos.' })
  @IsInt()
  @Min(1)
  capacity: number;
}
