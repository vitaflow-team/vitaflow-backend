import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AssignTurmaEducatorDTO {
  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Educador atualmente empregado por esta academia, ou null para deixar sem responsável.',
  })
  @IsOptional()
  @IsString()
  professionalId: string | null;
}
