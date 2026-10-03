import { AuthModule } from '@/auth/auth.module';
import { ConsentRepository } from '@/common/consent/consent.repository';
import { ConsentService } from '@/common/consent/consent.service';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { PrismaService } from '@/database/prisma.service';
import { NotificationsModule } from '@/notifications/notifications.module';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AssessmentsController } from './assessments/assessments.controller';
import { AssessmentsService } from './assessments/assessments.service';
import { DeclarationController } from './assessments/declaration.controller';
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
    AssessmentsController,
    DeclarationController,
    WorkoutsController,
    StudentWorkoutsController,
    FixedTimesController,
  ],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    PhysicalAssessmentsRepository,
    EducatorWorkoutsRepository,
    ExercisesRepository,
    FitnessProfileRepository,
    ConsentRepository,
    ConsentService,
    PhysicalEducatorGuard,
    AccountLookupThrottlerGuard,
    StudentsService,
    AssessmentsService,
    WorkoutNotificationsService,
    EducatorWorkoutsService,
    StudentWorkoutsService,
    Clock,
  ],
})
export class EducatorStudentsModule {}
