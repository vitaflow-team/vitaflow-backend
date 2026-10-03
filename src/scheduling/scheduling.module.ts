import { AuthModule } from '@/auth/auth.module';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { PrismaService } from '@/database/prisma.service';
import { NotificationsModule } from '@/notifications/notifications.module';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { SchedulingRepository } from '@/repositories/scheduling/scheduling.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { BookingController } from './booking.controller';
import { Clock } from './clock.service';
import { FixedTimesModule } from './fixed-times/fixedTimes.module';
import { FixedSessionReminderCron } from './fixed-times/fixedSessionReminder.cron';
import { FixedSessionsController } from './fixed-times/fixedSessions.controller';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { ReminderCronService } from './reminder-cron.service';
import { SchedulingService } from './scheduling.service';

@Module({
  imports: [AuthModule, NotificationsModule, FixedTimesModule],
  controllers: [
    AvailabilityController,
    BookingController,
    FixedSessionsController,
  ],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    ProfessionalGuard,
    SchedulingRepository,
    Clock,
    SchedulingService,
    ReminderCronService,
    FixedSessionReminderCron,
    EducatorWorkoutsRepository,
    PhysicalEducatorGuard,
  ],
})
export class SchedulingModule {}
