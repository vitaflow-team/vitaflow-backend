import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { MailModule } from '@/mail/mail.module';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [AuthModule, MailModule],
  controllers: [NotificationsController],
  providers: [
    PrismaService,
    UserRepository,
    NotificationsRepository,
    NotificationsService,
  ],
  // Exported so any other feature module imports NotificationsModule and
  // injects NotificationsService directly (in-process, no queue) — the
  // generic capability ADR-002 commits this PRD to providing.
  exports: [NotificationsService],
})
export class NotificationsModule {}
