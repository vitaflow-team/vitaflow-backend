import { ApiProperty } from '@nestjs/swagger';

export class PeriodComparisonMetricDTO {
  @ApiProperty({ enum: ['weight', 'diaryLoggedDays'] })
  metric: 'weight' | 'diaryLoggedDays';

  @ApiProperty({ nullable: true, example: 70.5 })
  current: number | null;

  @ApiProperty({ nullable: true, example: 71.8 })
  previous: number | null;

  @ApiProperty({
    nullable: true,
    example: -1.8,
    description:
      'null when the previous period has no data (divide-by-zero safe).',
  })
  deltaPercent: number | null;

  @ApiProperty({
    required: false,
    example: true,
    description:
      'Present and true only when current is 0 while the previous period had data.',
  })
  noActivityThisPeriod?: boolean;
}
