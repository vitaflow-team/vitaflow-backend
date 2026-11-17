import { ApiProperty } from '@nestjs/swagger';
import { BackofficeTier } from '@prisma/client';

// Response of POST /backoffice/staff/invitation/preview. Decorated for
// Swagger, never validated. Deliberately carries nothing that identifies
// the account: whoever holds the link learns only what is being offered.
export class StaffInvitationPreviewResponseDTO {
  @ApiProperty({ enum: BackofficeTier, example: BackofficeTier.EQUIPE })
  tier: BackofficeTier;

  @ApiProperty({
    example: false,
    description: 'Whether the invited account already signs in with Google.',
  })
  googleLinked: boolean;
}
