import { ApiProperty } from '@nestjs/swagger';

export class BmiPointDTO {
  @ApiProperty({ example: '2026-01-15T10:00:00.000Z' })
  recordedAt: string;

  @ApiProperty({ example: 23 })
  bmi: number;

  @ApiProperty({
    required: false,
    example: 'Thiago Ramos',
    description:
      'Present only for a point measured by an educator, so a chart can name who measured it.',
  })
  educatorName?: string;
}
