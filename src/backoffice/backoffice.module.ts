import { AuthModule } from '@/auth/auth.module';
import { BillingModule } from '@/billing/billing.module';
import { PrismaService } from '@/database/prisma.service';
import { MailModule } from '@/mail/mail.module';
import { AcademiaStaffMemberRepository } from '@/repositories/academia/academiaStaffMember.repository';
import { BackofficeViewAsSessionRepository } from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { Clock } from '@/scheduling/clock.service';
import { UserTokenService } from '@/users/token/userToken.service';
import { PLATFORM_ASAAS_API_KEY } from '@/users/subscription/platformGateway.tokens';
import { PasswordHash } from '@/utils/password.hash';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLogController } from './auditLog/auditLog.controller';
import { AuditLogService } from './auditLog/auditLog.service';
import { BackofficeDirectoryController } from './directory/backofficeDirectory.controller';
import { BackofficeDirectoryService } from './directory/backofficeDirectory.service';
import { MetricsController } from './metrics/metrics.controller';
import { MetricsService } from './metrics/metrics.service';
import { BackofficeStaffController } from './staff/backofficeStaff.controller';
import { BackofficeStaffService } from './staff/backofficeStaff.service';
import { ViewAsExpirySweepCron } from './viewAs/viewAsExpirySweep.cron';
import { ViewAsRetentionPurgeCron } from './viewAs/viewAsRetentionPurge.cron';
import { ViewAsSessionController } from './viewAs/viewAsSession.controller';
import { ViewAsSessionService } from './viewAs/viewAsSession.service';

@Module({
  imports: [AuthModule, MailModule, BillingModule],
  controllers: [
    BackofficeStaffController,
    BackofficeDirectoryController,
    ViewAsSessionController,
    AuditLogController,
    MetricsController,
  ],
  providers: [
    PrismaService,
    UserRepository,
    UserTokenRepository,
    UserTokenService,
    PasswordHash,
    BackofficeViewAsSessionRepository,
    BackofficeStaffService,
    AcademiaStaffMemberRepository,
    BackofficeDirectoryService,
    ViewAsSessionService,
    AuditLogService,
    ViewAsExpirySweepCron,
    ViewAsRetentionPurgeCron,
    MetricsService,
    Clock,
    // Same PLATFORM_ASAAS_API_KEY token UsersModule's SubscriptionService
    // already injects (platformGateway.tokens.ts) — re-provided here with
    // the same factory since UsersModule doesn't export it, no new env var.
    {
      provide: PLATFORM_ASAAS_API_KEY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<string>('ASAAS_PLATFORM_API_KEY'),
    },
  ],
})
export class BackofficeModule {}
