import { ApiProperty } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsNotEmpty,
  Matches,
  MinLength,
} from 'class-validator';

export class SignUpDTO {
  @ApiProperty({
    description: 'Full name of the user',
    example: 'John Doe',
  })
  @IsNotEmpty({ message: 'Name is mandatory.' })
  name: string;

  @ApiProperty({
    description: 'User email address (must be unique and used for login).',
    example: 'johndoe@example.com',
  })
  @IsNotEmpty({ message: 'Email is mandatory.' })
  email: string;

  @ApiProperty({
    description: 'User password used for authentication.',
    example: 'StrongPass123',
  })
  @IsNotEmpty({ message: 'Password is mandatory.' })
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
  @IsNotEmpty({ message: 'Confirm password is required.' })
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
