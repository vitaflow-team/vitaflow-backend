import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export class SignInDTO {
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
}
