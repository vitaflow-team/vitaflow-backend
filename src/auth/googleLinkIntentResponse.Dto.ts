import { ApiProperty } from '@nestjs/swagger';

// Response of POST /auth/google/link-intent. Decorated for Swagger, never
// validated.
export class GoogleLinkIntentResponseDTO {
  @ApiProperty({
    description:
      'Short-lived proof that the signed-in owner asked to connect Google.',
  })
  intent: string;
}
