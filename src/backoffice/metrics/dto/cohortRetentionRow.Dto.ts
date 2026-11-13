import { ROLES } from './platformRole';
import { ApiProperty } from '@nestjs/swagger';

export class CohortRetentionRowDTO {
  @ApiProperty({ description: '"yyyy-MM", UTC' })
  cohortMonth!: string;

  @ApiProperty({ enum: ROLES })
  role!: 'USER' | 'NUTRITIONIST' | 'PHYSICAL_EDUCATOR' | 'ACADEMIA';

  @ApiProperty({ enum: ['FREE', 'PREMIUM'] })
  plan!: 'FREE' | 'PREMIUM';

  @ApiProperty()
  cohortSize!: number;

  @ApiProperty({
    type: [Number],
    nullable: true,
    description:
      'Index = months since signup. null = not yet elapsed, never 0.',
  })
  retainedPercentByMonth!: (number | null)[];
}
