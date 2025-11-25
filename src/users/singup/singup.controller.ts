import { MailService } from '@/mail/mail.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
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

    private userToken: UserTokenRepository,

    private mailService: MailService,
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
    description: 'Este e-mail já está sendo usado por outro usuário.',
  })
  @Post('singup')
  async postNewUser(@Body() body: SingUpDTO) {
    const { email, name, password, checkPassword } = body;

    if (checkPassword !== password) {
      throw new AppError(
        'A confirmação da senha não corresponde à senha.',
        400,
      );
    }

    const userExists = await this.user.findByEmail({ email });
    if (userExists) {
      throw new AppError(
        'Este e-mail já está sendo usado por outro usuário.',
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

    const userTokenCreated = await this.userToken.create({
      user: { connect: userCreated },
    });

    const activationLink = `${process.env.APP_URL}/singin/activate?token=${userTokenCreated.id}`;

    await this.mailService.sendEmailPassword(
      name,
      email,
      'Ative sua conta',
      './activation',
      activationLink,
    );

    return {
      ...userCreated,
      password: undefined,
    };
  }
}
