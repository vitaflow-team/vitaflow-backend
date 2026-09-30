import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { MealsRepository } from '@/repositories/food-diary/meals.repository';
import { WaterLogRepository } from '@/repositories/food-diary/waterLog.repository';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { openAiClientProvider } from '@/workouts/openaiClient.provider';
import { Module } from '@nestjs/common';
import { CalorieEstimationService } from './calorieEstimation.service';
import { FoodDiaryController } from './foodDiary.controller';
import { FoodDiaryService } from './foodDiary.service';

@Module({
  imports: [AuthModule],
  controllers: [FoodDiaryController],
  providers: [
    PrismaService,
    UserRepository,
    MealsRepository,
    WaterLogRepository,
    FitnessProfileRepository,
    MeasurementRecordsRepository,
    openAiClientProvider,
    CalorieEstimationService,
    FoodDiaryService,
  ],
})
export class FoodDiaryModule {}
