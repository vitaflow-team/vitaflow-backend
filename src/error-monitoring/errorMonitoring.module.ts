import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { MailModule } from '@/mail/mail.module';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorMonitoringController } from './errorMonitoring.controller';
import { ErrorMonitoringService } from './errorMonitoring.service';
import {
  ERROR_ALERT_EMAIL,
  SENTRY_BACKEND_PROJECT_SLUG,
  SENTRY_FRONTEND_PROJECT_SLUG,
} from './errorMonitoring.tokens';
import { SentryGateway } from './gateway/sentry/sentryGateway';
import { SENTRY_GATEWAY } from './gateway/sentry/sentryGateway.tokens';
import { NewIssueAlertCron } from './newIssueAlertCron';

// Its own module (unlike auditLog, registered directly inside
// BackofficeModule) because it also owns the cron and the exception filter,
// which don't belong inside BackofficeModule. `AuthModule` is imported for
// AuthGuard (exported there); `PrismaService`/`UserRepository` are provided
// directly, matching BackofficeModule's own pattern, so AdminTierGuard's
// constructor dependency resolves within this module too.
@Module({
  imports: [AuthModule, MailModule],
  controllers: [ErrorMonitoringController],
  providers: [
    PrismaService,
    UserRepository,
    ErrorMonitoringService,
    NewIssueAlertCron,
    {
      provide: SENTRY_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new SentryGateway(
          config.getOrThrow<string>('SENTRY_ORG_SLUG'),
          config.getOrThrow<string>('SENTRY_API_TOKEN'),
        ),
    },
    {
      provide: SENTRY_BACKEND_PROJECT_SLUG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<string>('SENTRY_BACKEND_PROJECT_SLUG'),
    },
    {
      provide: SENTRY_FRONTEND_PROJECT_SLUG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<string>('SENTRY_FRONTEND_PROJECT_SLUG'),
    },
    {
      provide: ERROR_ALERT_EMAIL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<string>('ERROR_ALERT_EMAIL'),
    },
  ],
})
export class ErrorMonitoringModule {}
