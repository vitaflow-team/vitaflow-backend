import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, Matches, MinLength } from 'class-validator';

export class NewPasswordDto {
  @ApiProperty({
    example: 'cmiey0mgp0000jx040f59udf1',
    description: 'Password recovery token to be validated.',
  })
  token: string;

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
}
