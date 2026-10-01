import { ApiProperty } from '@nestjs/swagger';
import { ProductType } from '@prisma/client';

// No rating/review field exists anywhere on this shape (ADR-001, UT-005) —
// that omission is itself part of the contract, not an oversight.
export class ProfessionalSummaryEntity {
  @ApiProperty({ description: "Professional's user id." })
  id: string;

  @ApiProperty({ description: "Professional's full name." })
  name: string;

  @ApiProperty({ enum: ProductType, description: 'Professional type.' })
  type: ProductType;

  @ApiProperty({
    description: 'Specialty text, null when never set.',
    nullable: true,
  })
  specialty: string | null;

  @ApiProperty({
    description: 'Starting price, null when never set.',
    nullable: true,
  })
  priceFrom: number | null;

  @ApiProperty({ description: 'Whether this professional attends online.' })
  attendsOnline: boolean;
}

export class ProfessionalProfileEntity extends ProfessionalSummaryEntity {
  @ApiProperty({
    description: 'Free-text bio, null when never set.',
    nullable: true,
  })
  bio: string | null;
}
