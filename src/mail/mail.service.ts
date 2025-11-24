import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) {}

  async sendActivationEmail(name: string, email: string, token: string) {
    const activationLink = `${process.env.APP_URL}/singin/activate?token=${token}`;

    await this.mailerService.sendMail({
      to: email,
      subject: 'Ative sua conta',
      template: './activation',
      context: {
        name: name,
        link: activationLink,
      },
    });
  }

  async resetPasswordEmail(name: string, email: string, token: string) {
    const resetPasswordLink = `${process.env.APP_URL}/singin/activate?token=${token}`;

    await this.mailerService.sendMail({
      to: email,
      subject: 'Ative sua conta',
      template: './resetpassword',
      context: {
        name: name,
        link: resetPasswordLink,
      },
    });
  }
}
