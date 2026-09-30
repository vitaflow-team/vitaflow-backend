import { ApiProperty } from '@nestjs/swagger';
import {
  Exercise,
  ExerciseContraindication,
  ExerciseEquipment,
  ExerciseStatus,
} from '@prisma/client';

export class ExerciseEntity implements Exercise {
  @ApiProperty({
    description: 'Unique identifier of the exercise',
    example: '01890a5d-ac96-774b-bcce-b302099a8057',
  })
  id: string;

  @ApiProperty({
    description: 'Exercise name, in whatever language is currently stored',
    example: 'Supino reto',
  })
  name: string;

  @ApiProperty({
    description: 'How to perform the exercise',
    example: 'Deitado no banco, empurre a barra até estender os braços.',
  })
  description: string;

  @ApiProperty({ description: 'Main muscle group', example: 'Peito' })
  muscleGroup: string;

  @ApiProperty({
    description: 'Primary muscles worked',
    type: [String],
    example: ['Peito', 'Tríceps'],
  })
  primaryMuscles: string[];

  @ApiProperty({
    description: 'Secondary muscles worked',
    type: [String],
    example: ['Ombro'],
  })
  secondaryMuscles: string[];

  @ApiProperty({
    description: 'Equipment or training location required',
    enum: ExerciseEquipment,
    example: ExerciseEquipment.GYM,
  })
  equipment: ExerciseEquipment;

  @ApiProperty({
    description: 'Curated contraindications; empty until curated',
    enum: ExerciseContraindication,
    isArray: true,
    example: [],
  })
  contraindications: ExerciseContraindication[];

  @ApiProperty({
    description: 'Difficulty level',
    example: 'Intermediário',
    nullable: true,
  })
  difficulty: string | null;

  @ApiProperty({
    description: 'Demonstration image URL',
    example: 'https://cdn.example.com/supino.png',
    nullable: true,
  })
  imageUrl: string | null;

  @ApiProperty({
    description: 'Demonstration video URL; null when there is no video',
    example: 'https://cdn.example.com/supino.mp4',
    nullable: true,
  })
  videoUrl: string | null;

  @ApiProperty({
    description: 'Review status',
    enum: ExerciseStatus,
    example: ExerciseStatus.APPROVED,
  })
  status: ExerciseStatus;

  @ApiProperty({
    description: 'Upstream data source; null for exercises authored in-house',
    example: 'wger / exercemus',
    nullable: true,
  })
  sourceAttribution: string | null;

  @ApiProperty({
    description: 'License of the upstream data; null when authored in-house',
    example: 'CC-BY-SA 3.0',
    nullable: true,
  })
  sourceLicense: string | null;

  @ApiProperty({
    description: 'Educator who submitted the exercise, when submitted',
    example: 'user-uuid-string',
    nullable: true,
  })
  submittedById: string | null;

  @ApiProperty({
    description: 'Backoffice operator who approved, rejected or created it',
    example: 'user-uuid-string',
    nullable: true,
  })
  reviewedById: string | null;

  @ApiProperty({
    description: 'Reason given when the submission was rejected',
    example: null,
    nullable: true,
  })
  rejectionReason: string | null;

  @ApiProperty({
    description: 'Date when the exercise was created',
    example: '2026-01-01T00:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Date when the exercise was last updated',
    example: '2026-01-01T00:00:00.000Z',
  })
  updatedAt: Date;
}
