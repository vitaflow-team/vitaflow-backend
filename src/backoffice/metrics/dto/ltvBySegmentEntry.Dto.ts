import { ROLES } from './platformRole';
import { ApiProperty } from '@nestjs/swagger';

export class LtvBySegmentEntryDTO {
  @ApiProperty({ enum: ROLES })
  role!: 'USER' | 'NUTRITIONIST' | 'PHYSICAL_EDUCATOR' | 'ACADEMIA';

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      "Projected LTV (ARPU ÷ monthly churn rate) for this role's Premium " +
      'segment. null means not enough data (zero churn or zero active ' +
      'Premium users), never "zero value".',
  })
  ltv!: number | null;
}
