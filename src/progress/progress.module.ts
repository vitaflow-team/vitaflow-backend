import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { FormRecordsRepository } from '@/repositories/clinical-records/formRecords.repository';
import { MealsRepository } from '@/repositories/food-diary/meals.repository';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { WorkoutsRepository } from '@/repositories/workouts/workouts.repository';
import { Module } from '@nestjs/common';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';

@Module({
  imports: [AuthModule],
  controllers: [ProgressController],
  providers: [
    PrismaService,
    UserRepository,
    MeasurementRecordsRepository,
    FormRecordsRepository,
    MealsRepository,
    WorkoutsRepository,
    ProgressService,
  ],
})
export class ProgressModule {}
