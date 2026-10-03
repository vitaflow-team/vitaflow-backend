import { ApiProperty } from '@nestjs/swagger';
import type { BmiClassification } from '../bmi.util';

// Response shape only: decorated for Swagger, never validated.
export class MeasurementRecordResponseDTO {
  @ApiProperty({ example: 'cuid-record-123' })
  id: string;

  @ApiProperty({ example: 70.5 })
  weightKg: number;

  @ApiProperty({ example: 175 })
  heightCm: number;

  @ApiProperty({ example: 80, nullable: true, type: Number })
  waistCm: number | null;

  @ApiProperty({ example: 95, nullable: true, type: Number })
  hipCm: number | null;

  @ApiProperty({ example: '2026-01-15T10:00:00.000Z' })
  recordedAt: string;

  @ApiProperty({ example: 23 })
  bmi: number;

  @ApiProperty({ example: 'PESO_NORMAL' })
  bmiClassification: BmiClassification;

  @ApiProperty({
    enum: ['SELF', 'EDUCATOR'],
    description: 'Who recorded the point: the user or a linked educator.',
  })
  source: 'SELF' | 'EDUCATOR';

  @ApiProperty({
    description:
      'True for an educator point: the user cannot edit or delete it.',
  })
  readOnly: boolean;

  @ApiProperty({
    example: 'Thiago Ramos',
    nullable: true,
    type: String,
    description: 'The educator who measured it; null for the user own records.',
  })
  educatorName: string | null;
}
