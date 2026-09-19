import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

@Module({
  imports: [
    // Imported here too (not just in AppModule) so MailModule resolves
    // ConfigService on its own — @nestjs/config supports calling forRoot()
    // from multiple modules, and this keeps MailModule testable in
    // isolation (e.g. inside module specs that don't bootstrap AppModule).
    ConfigModule.forRoot({ isGlobal: true }),
    // forRootAsync (not forRoot) so MAIL_* is read via ConfigService during
    // Nest's DI resolution, not at module-import time — imports execute
    // before ConfigModule.forRoot() has loaded .env, so a plain
    // `process.env.MAIL_HOST` read here was always undefined.
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get<string>('MAIL_HOST'),
          port: Number(config.get<string>('MAIL_PORT')),
          secure: true,
          auth: {
            user: config.get<string>('MAIL_USER'),
            pass: config.get<string>('MAIL_PASS'),
          },
        },
        defaults: {
          from: `"Vitaflow" <${config.get<string>('MAIL_USER')}>`,
        },
        template: {
          dir: __dirname + '/templates',
          adapter: new HandlebarsAdapter(),
        },
      }),
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
