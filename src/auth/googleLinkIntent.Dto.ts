import { PASSWORD_MAX_BYTES } from '@/utils/password.hash';
import { ApiProperty } from '@nestjs/swagger';
import { IsByteLength, IsOptional, IsString } from 'class-validator';

// The password is the account's existing one and is required only from an
// account with internal-staff access — the service decides, since only it
// knows which kind of account is asking.
export class GoogleLinkIntentDTO {
  @ApiProperty({
    required: false,
    description:
      'Current password. Required when the account has staff access.',
  })
  @IsOptional()
  @IsString()
  @IsByteLength(0, PASSWORD_MAX_BYTES, {
    message: `The password must be at most ${PASSWORD_MAX_BYTES} bytes long.`,
  })
  password?: string;
}
