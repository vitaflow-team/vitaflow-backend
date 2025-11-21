import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional } from 'class-validator';

export class SingInDTO {
  @ApiProperty({
    description: 'User email address (must be unique and used for login).',
    example: 'johndoe@example.com',
  })
  @IsNotEmpty({ message: 'Email is mandatory.' })
  email: string;

  @ApiProperty({
    description: 'Password used to login the APP.',
    example: 'Password123',
  })
  @IsNotEmpty({ message: 'Password is mandatory.' })
  password: string;

  @ApiProperty({
    description:
      'Indicates whether the user signed up or logged in using a social provider (e.g., Google, Facebook).',
    example: false,
  })
  @IsBoolean({
    message: 'The socialLogin field must be a boolean value (true or false).',
  })
  @IsOptional()
  socialLogin: boolean;
}
