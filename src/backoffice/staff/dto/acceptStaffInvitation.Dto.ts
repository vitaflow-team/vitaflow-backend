import { PASSWORD_MAX_BYTES } from '@/utils/password.hash';
import { ApiProperty } from '@nestjs/swagger';
import { IsByteLength, IsNotEmpty, IsString, MaxLength } from 'class-validator';

// The password is the account's existing one, checked against the stored
// hash — so only its presence and length are validated here, never the
// strength rules that apply when a password is being chosen.
export class AcceptStaffInvitationDTO {
  @ApiProperty({ description: 'Token from the staff invitation link.' })
  @IsString()
  @IsNotEmpty({ message: 'Token is required.' })
  @MaxLength(512)
  token: string;

  @ApiProperty({ description: 'Current password of the invited account.' })
  @IsString()
  @IsNotEmpty({ message: 'Password is mandatory.' })
  @IsByteLength(0, PASSWORD_MAX_BYTES, {
    message: `The password must be at most ${PASSWORD_MAX_BYTES} bytes long.`,
  })
  password: string;
}
