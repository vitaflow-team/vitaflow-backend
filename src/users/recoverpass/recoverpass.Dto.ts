import { NormalizeEmail } from '@/utils/normalizeEmail';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class RecoverpassDTO {
  @ApiProperty({
    description: 'User email address (must be unique and used for login).',
    example: 'johndoe@example.com',
  })
  @NormalizeEmail()
  @IsNotEmpty({ message: 'Email is mandatory.' })
  @IsEmail({}, { message: 'Email must be a valid email address.' })
  email: string;
}
