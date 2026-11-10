import { ApiProperty } from '@nestjs/swagger';

export class TrendPointDTO {
  @ApiProperty({ example: '2026-01-15T10:00:00.000Z' })
  recordedAt: string;

  @ApiProperty({ example: 70.5 })
  weightKg: number;

  @ApiProperty({
    nullable: true,
    example: 71.2,
    description:
      '7-day moving average; null until 7 distinct days of history are available in the window.',
  })
  smoothedWeightKg: number | null;
}
