import { AuthModule } from '@/auth/auth.module';
import { NutritionistGuard } from '@/common/guards/nutritionist.guard';
import { PrismaService } from '@/database/prisma.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { MealsRepository } from '@/repositories/food-diary/meals.repository';
import { WaterLogRepository } from '@/repositories/food-diary/waterLog.repository';
import { MealPlansRepository } from '@/repositories/meal-plans/mealPlans.repository';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { Module } from '@nestjs/common';
import { NutritionistDashboardController } from './dashboard/nutritionistDashboard.controller';
import { NutritionistDashboardService } from './dashboard/nutritionistDashboard.service';
import { NutritionistPatientsController } from './nutritionistPatients.controller';
import { NutritionistPatientsService } from './nutritionistPatients.service';

@Module({
  imports: [AuthModule],
  controllers: [
    NutritionistPatientsController,
    NutritionistDashboardController,
  ],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    MealsRepository,
    WaterLogRepository,
    MealPlansRepository,
    MeasurementRecordsRepository,
    NutritionistGuard,
    NutritionistPatientsService,
    NutritionistDashboardService,
    Clock,
  ],
})
export class NutritionistPatientsModule {}
