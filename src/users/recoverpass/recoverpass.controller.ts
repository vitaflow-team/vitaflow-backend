import { MailService } from '@/mail/mail.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { NewPasswordDto } from './newPassword.Dto';
import { RecoverpassDTO } from './recoverpass.Dto';

@ApiTags('User')
@Controller('users')
export class RecoverpassController {
  constructor(
    private user: UserRepository,

    private userToken: UserTokenRepository,

    private mailService: MailService,

    private hash: PasswordHash,
  ) {}

  @ApiOperation({
    summary: 'Send password recovery email',
    description:
      'Creates a password recovery token and sends an email to the user.',
  })
  @ApiResponse({
    status: 201,
    description: 'Password recovery email sent successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Email not found.',
  })
  @Post('recoverpass')
  async postRecoverpass(@Body() body: RecoverpassDTO) {
    const { email } = body;

    const userExists = await this.user.findByEmail({ email });
    if (userExists) {
      await this.userToken.deleteAll({
        userID: userExists.id,
      });

      const token = await this.userToken.create({
        user: {
          connect: userExists,
        },
      });

      if (token) {
        const recoveryUrl = `${process.env.APP_URL}/signin?token=${token.id}`;

        await this.mailService.sendEmailPassword(
          userExists.name,
          email,
          'Recuperação de senha',
          './resetpassword',
          recoveryUrl,
        );

        return true;
      }
    }

    return false;
  }

  @ApiOperation({
    summary: 'Verify password recovery token',
    description:
      'Validates whether a provided password recovery token is valid, expired, or invalid.',
  })
  @ApiResponse({
    status: 200,
    description: 'Token is valid.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired token.',
  })
  @Post('newpassword')
  async postChangePassword(@Body() body: NewPasswordDto) {
    const { token, password, checkPassword } = body;

    const userToken = await this.userToken.findById({ id: token });
    if (userToken) {
      await this.userToken.deleteAll({
        userID: userToken.userID,
      });

      if (userToken.createdAt.getTime() + 10800000 > Date.now()) {
        if (checkPassword !== password) {
          throw new AppError(
            'A confirmação da senha não corresponde à senha.',
            401,
          );
        }

        const hasPassword = await this.hash.generateHash(password);

        await this.user.updatePassword(userToken.userID, hasPassword);

        return true;
      }
    }

    throw new AppError('Token inválido ou expirado.', 400);
  }
}
