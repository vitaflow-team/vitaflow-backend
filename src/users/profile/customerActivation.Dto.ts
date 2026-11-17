import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';

// Same two consents, under the same rules, as SignUpDTO: an account that
// was created without them (a staff invitation) gives them here, at the
// moment it becomes a customer (unified-login-account ADR-006).
export class CustomerActivationDTO {
  @ApiProperty({
    description:
      'Acceptance of the Terms of Use and Privacy Policy. Must be true.',
    example: true,
  })
  @IsBoolean({ message: 'termsAccepted must be a boolean value.' })
  @Equals(true, {
    message: 'You must accept the Terms of Use and Privacy Policy.',
  })
  termsAccepted: boolean;

  @ApiProperty({
    description:
      'Specific consent for processing sensitive health data, as required ' +
      'by LGPD art. 11. Must be true.',
    example: true,
  })
  @IsBoolean({ message: 'healthDataConsent must be a boolean value.' })
  @Equals(true, {
    message: 'You must consent to the processing of your health data.',
  })
  healthDataConsent: boolean;
}
