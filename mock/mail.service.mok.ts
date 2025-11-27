import { MailService } from '@/mail/mail.service';

export const mailServiceMock = {
  provide: MailService,
  useValue: {
    sendEmailPassword: jest.fn(),
  },
};
