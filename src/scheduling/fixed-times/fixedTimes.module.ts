import { PrismaService } from '@/database/prisma.service';
import { NotificationsModule } from '@/notifications/notifications.module';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { Clock } from '../clock.service';
import { FixedTimeNotificationsService } from './fixedTimeNotifications.service';
import { FixedTimesService } from './fixedTimes.service';
import { FixedSessionsService } from './fixedSessions.service';
import { FixedSessionsRenewalService } from './fixedSessionsRenewal.service';

@Module({
  imports: [NotificationsModule],
  providers: [
    PrismaService,
    ClientsRepository,
    EducatorWorkoutsRepository,
    UserRepository,
    FixedTimesRepository,
    Clock,
    FixedTimeNotificationsService,
    FixedTimesService,
    FixedSessionsService,
    FixedSessionsRenewalService,
  ],
  exports: [FixedTimesService, FixedSessionsService, FixedTimesRepository],
})
export class FixedTimesModule {}
