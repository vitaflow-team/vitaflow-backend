import { PASSWORD_MAX_BYTES } from '@/utils/password.hash';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsByteLength,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class ActivateStaffDTO {
  @ApiProperty({ description: 'Token for staff account activation.' })
  @IsString()
  @IsNotEmpty({ message: 'Token is required.' })
  token: string;

  @ApiProperty({
    description: 'Password to set for this staff account.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password is mandatory.' })
  @IsByteLength(0, PASSWORD_MAX_BYTES, {
    message: `The password must be at most ${PASSWORD_MAX_BYTES} bytes long.`,
  })
  @MinLength(8, { message: 'The password must be at least 8 characters long.' })
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message:
      'The password must contain uppercase, lowercase letters and numbers.',
  })
  password: string;
}
