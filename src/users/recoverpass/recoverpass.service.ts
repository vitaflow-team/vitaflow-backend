import { MailService } from '@/mail/mail.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { Injectable, Logger } from '@nestjs/common';
import { TokenType, Users } from '@prisma/client';
import { UserTokenService } from '@/users/token/userToken.service';
import { NewPasswordDto } from './newPassword.Dto';
import { RecoverpassDTO } from './recoverpass.Dto';

@Injectable()
export class RecoverpassService {
  private readonly logger = new Logger(RecoverpassService.name);

  constructor(
    private readonly user: UserRepository,
    private readonly userToken: UserTokenService,
    private readonly mailService: MailService,
    private readonly hash: PasswordHash,
  ) {}

  // The answer is the same whether or not the email has an account, and the
  // token/email work runs off the response path, so neither the body nor the
  // response time reveals which case it was.
  async postRecoverpass({ email }: RecoverpassDTO): Promise<true> {
    const user = await this.user.findByEmail(email);
    if (user) {
      void this.sendRecoveryEmail(user).catch((error: unknown) => {
        const reason = error instanceof Error ? error.name : 'unknown';
        this.logger.error(
          `password_recovery_email_failed user=${user.id} error=${reason}`,
        );
      });
    }

    return true;
  }

  async postChangePassword({
    token,
    password,
    checkPassword,
  }: NewPasswordDto): Promise<true> {
    const userToken = await this.userToken.findLive(token, TokenType.RECOVERY);
    if (!userToken) {
      throw new AppError('Token inválido ou expirado.', 400);
    }

    // Checked before consuming, so a typo doesn't burn the recovery link.
    if (checkPassword !== password) {
      throw new AppError(
        'A confirmação da senha não corresponde à senha.',
        401,
      );
    }

    const hasPassword = await this.hash.generateHash(password);
    const user = await this.user.updatePasswordWithToken(
      userToken,
      hasPassword,
    );
    if (!user) {
      throw new AppError('Token inválido ou expirado.', 400);
    }

    return true;
  }

  private async sendRecoveryEmail(user: Users): Promise<void> {
    const token = await this.userToken.issue(user.id, TokenType.RECOVERY);
    const recoveryUrl = `${process.env.APP_URL}/signin?token=${token}`;

    await this.mailService.sendEmailPassword(
      user.name,
      user.email,
      'Recuperação de senha',
      './resetpassword',
      recoveryUrl,
    );
  }
}
