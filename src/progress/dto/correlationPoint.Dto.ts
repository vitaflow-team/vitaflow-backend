import { ApiProperty } from '@nestjs/swagger';

export class CorrelationPointDTO {
  @ApiProperty({ example: '2026-01-15' })
  date: string;

  @ApiProperty({ nullable: true, example: 70.5 })
  weight: number | null;

  @ApiProperty({
    nullable: true,
    example: 100,
    description:
      '100 when a diary entry exists that day, otherwise null (not 0).',
  })
  diaryAdherencePercent: number | null;
}
