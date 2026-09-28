import { NormalizeEmail } from '@/utils/normalizeEmail';
import { PASSWORD_MAX_BYTES } from '@/utils/password.hash';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsByteLength,
  Equals,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class SignUpDTO {
  @ApiProperty({
    description: 'Full name of the user',
    example: 'John Doe',
  })
  @IsString()
  @IsNotEmpty({ message: 'Name is mandatory.' })
  name: string;

  @ApiProperty({
    description: 'User email address (must be unique and used for login).',
    example: 'johndoe@example.com',
  })
  @NormalizeEmail()
  @IsNotEmpty({ message: 'Email is mandatory.' })
  @IsEmail({}, { message: 'Email must be a valid email address.' })
  email: string;

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
      'Specific, highlighted consent for processing sensitive health data ' +
      '(weight, height, measurements, workouts, meal plans), as required by ' +
      'LGPD art. 11 for sensitive personal data. Must be true.',
    example: true,
  })
  @IsBoolean({ message: 'healthDataConsent must be a boolean value.' })
  @Equals(true, {
    message: 'You must consent to the processing of your health data.',
  })
  healthDataConsent: boolean;
}
