import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) {}

  async sendEmailPassword(
    name: string,
    email: string,
    subject: string,
    template: string,
    url: string,
  ) {
    await this.mailerService.sendMail({
      to: email,
      subject: subject,
      template: template,
      context: {
        name: name,
        link: url,
      },
    });
  }

  // Separate from sendEmailPassword: that method's context is fixed to
  // {name, link} (an activation/reset action link), while a notification
  // email centers on a message body and only optionally links out.
  async sendNotificationEmail(
    name: string,
    email: string,
    subject: string,
    message: string,
    link?: string,
  ) {
    await this.mailerService.sendMail({
      to: email,
      subject: subject,
      template: './notification',
      context: {
        name: name,
        message: message,
        link: link,
      },
    });
  }
}
