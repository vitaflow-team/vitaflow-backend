import { AuthModule } from '@/auth/auth.module';
import { ChurnRiskModule } from '@/academia/churn-risk/churnRisk.module';
import { NutritionistGuard } from '@/common/guards/nutritionist.guard';
import { PrismaService } from '@/database/prisma.service';
import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { InvoicesRepository } from '@/repositories/billing/invoices.repository';
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
  // ChurnRiskModule: so the dashboard can inject ChurnRiskEpisodeRepository
  // for its dismissed-patient filter (churn-risk-alert-independent ADR-006),
  // same pattern AcademiaModule already uses for EngajamentoService.
  imports: [AuthModule, ChurnRiskModule],
  controllers: [
    // Registered before NutritionistPatientsController: Nest/Express
    // matches routes in registration order, and NutritionistPatientsController's
    // GET ':id' would otherwise shadow GET 'nutritionist/patients/dashboard'
    // (id="dashboard"), a real 404 caught only by a live server boot, never
    // by Jest's per-controller TestingModule specs.
    NutritionistDashboardController,
    NutritionistPatientsController,
  ],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    MealsRepository,
    WaterLogRepository,
    MealPlansRepository,
    MeasurementRecordsRepository,
    BillingAccountRepository,
    InvoicesRepository,
    NutritionistGuard,
    NutritionistPatientsService,
    NutritionistDashboardService,
    Clock,
  ],
})
export class NutritionistPatientsModule {}
