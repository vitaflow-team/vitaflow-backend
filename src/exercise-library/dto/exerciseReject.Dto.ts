import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ExerciseRejectDto {
  @ApiProperty({
    description: 'Optional reason shown to the submitting educator.',
    required: false,
    example: 'Exercício duplicado de "Supino reto".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
