import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SingUpDTO } from './singup.Dto';

@ApiTags('User')
@Controller('users')
export class SingupController {
  constructor(
    private user: UserRepository,

    private hash: PasswordHash,
  ) {}

  @ApiOperation({
    summary: 'Creates a new user account',
    description:
      'Creates a new user account with an inactive status and generates an activation token.',
  })
  @ApiResponse({
    status: 201,
    description: 'User created successfully.',
    example: {
      id: 'cuid-user-456',
      name: 'John Doe',
      email: 'johndoe@example.com',
      avatar: 'https://example.com/avatar.jpg',
      active: false,
      createdAt: '2025-02-25T01:25:13.248Z',
      updatedAt: '2025-02-25T01:25:13.248Z',
    },
  })
  @ApiResponse({
    status: 400,
    description: 'This email is already used by another user.',
  })
  @Post('singup')
  async postNewUser(@Body() body: SingUpDTO) {
    const { email, name, password, checkPassword } = body;

    const userExists = await this.user.findByEmail({ email });
    if (userExists) {
      throw new AppError('This email is already used by another user.', 400);
    }

    if (checkPassword !== password) {
      throw new AppError(
        'The confirm password does not match the password.',
        400,
      );
    }

    const hasPassword = await this.hash.generateHash(password);

    const userCreated = await this.user.create({
      name,
      email,
      password: hasPassword,
      active: false,
    });

    return {
      ...userCreated,
      password: undefined,
    };
  }
}
