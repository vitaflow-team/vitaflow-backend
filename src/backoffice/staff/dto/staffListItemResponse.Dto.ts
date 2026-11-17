import { ApiProperty } from '@nestjs/swagger';
import { BackofficeTier } from '@prisma/client';

// One row of GET /backoffice/staff. Decorated for Swagger, never validated.
export class StaffListItemResponseDTO {
  @ApiProperty({ example: 'cuid-user-456' })
  id: string;

  @ApiProperty({ example: 'equipe' })
  name: string;

  @ApiProperty({ example: 'equipe@vitaflow.com' })
  email: string;

  @ApiProperty({
    nullable: true,
    enum: BackofficeTier,
    description: 'Held tier, or the tier offered by a pending invitation.',
  })
  tier: BackofficeTier | null;

  @ApiProperty({ example: true })
  active: boolean;

  @ApiProperty({
    example: false,
    description: 'True while the invitation has not been accepted.',
  })
  pending: boolean;

  @ApiProperty({ type: Date })
  createdAt: Date;
}
