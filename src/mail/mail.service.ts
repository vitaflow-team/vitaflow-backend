import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) {}

  async sendActivationEmail(email: string, token: string) {
    const activationLink = `${process.env.APP_URL}/singin/activate?token=${token}`;

    console.log(activationLink);

    await this.mailerService.sendMail({
      to: email,
      subject: 'Ative sua conta',
      template: './activation',
      context: {
        link: activationLink,
      },
    });
  }
}
