import { MailerService } from '@nestjs-modules/mailer';
import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from './mail.service';

describe('MailService Tests', () => {
  let service: MailService;
  let mailerService: MailerService;

  const mockMailerService = {
    sendMail: jest.fn().mockResolvedValue('email sent'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: MailerService,
          useValue: mockMailerService,
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
    mailerService = module.get<MailerService>(MailerService);
  });

  it('Should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendEmailPassword', () => {
    it('Should call sendMail with the correct parameters', async () => {
      const name = 'João Silva';
      const email = 'joao@example.com';
      const subject = 'Password Recovery';
      const template = 'recover-password';
      const url = 'https://meusite.com/reset?token=123';

      await service.sendEmailPassword(name, email, subject, template, url);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mailerService.sendMail).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mailerService.sendMail).toHaveBeenCalledWith({
        to: email,
        subject: subject,
        template: template,
        context: {
          name: name,
          link: url,
        },
      });
    });

    it('Should throw an error if mailerService fails', async () => {
      jest
        .spyOn(mailerService, 'sendMail')
        .mockRejectedValueOnce(new Error('SMTP Error'));

      await expect(
        service.sendEmailPassword(
          'Nome',
          'email@test.com',
          'Subject',
          'tpl',
          'url',
        ),
      ).rejects.toThrow('SMTP Error');
    });
  });

  describe('sendNotificationEmail', () => {
    it('Should call sendMail with the notification template and message context', async () => {
      await service.sendNotificationEmail(
        'João Silva',
        'joao@example.com',
        'Nova notificação',
        'Seu pagamento falhou.',
        'https://app.vitaflow.com/restrict/settings?tab=plano',
      );

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mailerService.sendMail).toHaveBeenCalledWith({
        to: 'joao@example.com',
        subject: 'Nova notificação',
        template: './notification',
        context: {
          name: 'João Silva',
          message: 'Seu pagamento falhou.',
          link: 'https://app.vitaflow.com/restrict/settings?tab=plano',
        },
      });
    });

    it('Should pass an undefined link when none is given', async () => {
      await service.sendNotificationEmail(
        'João Silva',
        'joao@example.com',
        'Nova notificação',
        'Mensagem sem link.',
      );

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ link: undefined }),
        }),
      );
    });

    it('Should throw an error if mailerService fails', async () => {
      jest
        .spyOn(mailerService, 'sendMail')
        .mockRejectedValueOnce(new Error('SMTP Error'));

      await expect(
        service.sendNotificationEmail(
          'Nome',
          'email@test.com',
          'Subject',
          'msg',
        ),
      ).rejects.toThrow('SMTP Error');
    });
  });
});
