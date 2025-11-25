import { MailService } from '@/mail/mail.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RecoverpassDTO } from './recoverpass.Dto';

@ApiTags('User')
@Controller('users')
export class RecoverpassController {
  constructor(
    private user: UserRepository,

    private userToken: UserTokenRepository,

    private mailService: MailService,
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

      const recoveryUrl = `${process.env.APP_URL}/singin/recoverpass?token=${token.id}`;

      await this.mailService.sendEmailPassword(
        userExists.name,
        email,
        'Recuperação de senha',
        './resetpassword',
        recoveryUrl,
      );

      return true;
    }

    return false;
  }
}
