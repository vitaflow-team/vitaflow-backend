import { MailService } from '@/mail/mail.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { Injectable } from '@nestjs/common';
import { NewPasswordDto } from './newPassword.Dto';
import { RecoverpassDTO } from './recoverpass.Dto';

@Injectable()
export class RecoverpassService {
  constructor(
    private user: UserRepository,

    private userToken: UserTokenRepository,

    private mailService: MailService,

    private hash: PasswordHash,
  ) {}

  async postRecoverpass({ email }: RecoverpassDTO) {
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

  async postChangePassword({ token, password, checkPassword }: NewPasswordDto) {
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
