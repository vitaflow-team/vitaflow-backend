import { PASSWORD_MAX_BYTES } from '@/utils/password.hash';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsByteLength,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class NewPasswordDto {
  @ApiProperty({
    example: 'cmiey0mgp0000jx040f59udf1',
    description: 'Password recovery token to be validated.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Token is required.' })
  token: string;

  @ApiProperty({
    description: 'User password used for authentication.',
    example: 'StrongPass123',
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

  @ApiProperty({
    description: 'Password confirmation (must match the password field).',
    example: 'StrongPass123',
  })
  @IsString()
  @IsNotEmpty({ message: 'Confirm password is required.' })
  @IsByteLength(0, PASSWORD_MAX_BYTES, {
    message: `The confirm password must be at most ${PASSWORD_MAX_BYTES} bytes long.`,
  })
  @MinLength(8, {
    message: 'The confirm password must be at least 8 characters long.',
  })
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message:
      'The confirm password must contain uppercase, lowercase letters, and at least one number or special character.',
  })
  checkPassword: string;
}
