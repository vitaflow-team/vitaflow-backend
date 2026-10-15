import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { MailModule } from '@/mail/mail.module';
import { AcademiaStaffMemberRepository } from '@/repositories/academia/academiaStaffMember.repository';
import { BackofficeViewAsSessionRepository } from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { UserTokenService } from '@/users/token/userToken.service';
import { PasswordHash } from '@/utils/password.hash';
import { Module } from '@nestjs/common';
import { AuditLogController } from './auditLog/auditLog.controller';
import { AuditLogService } from './auditLog/auditLog.service';
import { BackofficeDirectoryController } from './directory/backofficeDirectory.controller';
import { BackofficeDirectoryService } from './directory/backofficeDirectory.service';
import { BackofficeStaffController } from './staff/backofficeStaff.controller';
import { BackofficeStaffService } from './staff/backofficeStaff.service';
import { ViewAsExpirySweepCron } from './viewAs/viewAsExpirySweep.cron';
import { ViewAsRetentionPurgeCron } from './viewAs/viewAsRetentionPurge.cron';
import { ViewAsSessionController } from './viewAs/viewAsSession.controller';
import { ViewAsSessionService } from './viewAs/viewAsSession.service';

@Module({
  imports: [AuthModule, MailModule],
  controllers: [
    BackofficeStaffController,
    BackofficeDirectoryController,
    ViewAsSessionController,
    AuditLogController,
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
  ],
})
export class BackofficeModule {}
