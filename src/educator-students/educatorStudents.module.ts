import { AcademiaActivityService } from '@/academia/activity/academiaActivity.service';
import { AuthModule } from '@/auth/auth.module';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { PrismaService } from '@/database/prisma.service';
import { NotificationsModule } from '@/notifications/notifications.module';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { FormRecordsRepository } from '@/repositories/clinical-records/formRecords.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccountLookupThrottlerGuard } from './students/accountLookupThrottler.guard';
import { StudentsController } from './students/students.controller';
import { StudentsService } from './students/students.service';
import { FixedTimesController } from './schedule/fixedTimes.controller';
import { FixedTimesModule } from '@/scheduling/fixed-times/fixedTimes.module';
import { Clock } from '@/scheduling/clock.service';
import { StudentWorkoutsController } from './workouts/studentWorkouts.controller';
import { StudentWorkoutsService } from './workouts/studentWorkouts.service';
import { WorkoutNotificationsService } from './workouts/workoutNotifications.service';
import { WorkoutsController } from './workouts/workouts.controller';
import { EducatorWorkoutsService } from './workouts/workouts.service';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    FixedTimesModule,
    // Own throttler storage: the account lookup limit is independent of the
    // auth routes' throttlers and keyed by the authenticated educator.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
  ],
  controllers: [
    StudentsController,
    WorkoutsController,
    StudentWorkoutsController,
    FixedTimesController,
  ],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    EmploymentRepository,
    AcademiaActivityService,
    FormRecordsRepository,
    EducatorWorkoutsRepository,
    ExercisesRepository,
    FitnessProfileRepository,
    PhysicalEducatorGuard,
    AccountLookupThrottlerGuard,
    StudentsService,
    WorkoutNotificationsService,
    EducatorWorkoutsService,
    StudentWorkoutsService,
    Clock,
  ],
  exports: [StudentsService],
})
export class EducatorStudentsModule {}
