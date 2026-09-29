import { NormalizeEmail } from '@/utils/normalizeEmail';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class SignInDTO {
  @ApiProperty({
    description: 'User email address (must be unique and used for login).',
    example: 'johndoe@example.com',
  })
  @NormalizeEmail()
  @IsNotEmpty({ message: 'Email is mandatory.' })
  @IsEmail({}, { message: 'Email must be a valid email address.' })
  email: string;

  @ApiProperty({
    description: 'Password used to login the APP.',
    example: 'Password123',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password is mandatory.' })
  password: string;
}
