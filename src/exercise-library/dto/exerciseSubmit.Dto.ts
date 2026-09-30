import { ApiProperty } from '@nestjs/swagger';
import { ExerciseContraindication, ExerciseEquipment } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

// Fields an educator provides when proposing an exercise. Status and review
// fields are never accepted from the client: a submission always starts
// PENDING.
export class ExerciseSubmitDto {
  @ApiProperty({ description: 'Exercise name.', example: 'Supino reto' })
  @IsString()
  @IsNotEmpty({ message: 'O nome do exercício é obrigatório.' })
  @MaxLength(120)
  name: string;

  @ApiProperty({
    description: 'How to perform the exercise.',
    example: 'Deitado no banco, empurre a barra até estender os braços.',
  })
  @IsString()
  @IsNotEmpty({ message: 'A descrição do exercício é obrigatória.' })
  @MaxLength(5000)
  description: string;

  @ApiProperty({ description: 'Main muscle group.', example: 'Peito' })
  @IsString()
  @IsNotEmpty({ message: 'O grupo muscular é obrigatório.' })
  @MaxLength(60)
  muscleGroup: string;

  @ApiProperty({
    description: 'Equipment or training location the exercise requires.',
    enum: ExerciseEquipment,
    example: ExerciseEquipment.GYM,
  })
  @IsEnum(ExerciseEquipment)
  equipment: ExerciseEquipment;

  @ApiProperty({
    description: 'Physical restrictions the exercise should be avoided for.',
    enum: ExerciseContraindication,
    isArray: true,
    required: false,
    example: [ExerciseContraindication.SHOULDER],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(ExerciseContraindication, { each: true })
  contraindications?: ExerciseContraindication[];

  @ApiProperty({
    description: 'Primary muscles worked.',
    type: [String],
    required: false,
    example: ['Peito', 'Tríceps'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  primaryMuscles?: string[];

  @ApiProperty({
    description: 'Secondary muscles worked.',
    type: [String],
    required: false,
    example: ['Ombro'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  secondaryMuscles?: string[];

  @ApiProperty({
    description: 'Difficulty level.',
    required: false,
    example: 'Intermediário',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  difficulty?: string;

  @ApiProperty({
    description: 'Demonstration image URL.',
    required: false,
    example: 'https://cdn.example.com/supino.png',
  })
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiProperty({
    description: 'Demonstration video URL.',
    required: false,
    example: 'https://cdn.example.com/supino.mp4',
  })
  @IsOptional()
  @IsUrl()
  videoUrl?: string;
}
