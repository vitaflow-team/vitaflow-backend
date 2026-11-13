import { AuthModule } from '@/auth/auth.module';
import { NotificationsModule } from '@/notifications/notifications.module';
import { AcademiaRepository } from '@/repositories/academia/academia.repository';
import { CheckInRepository } from '@/repositories/academia/checkIn.repository';
import { ChurnRiskEpisodeRepository } from '@/repositories/academia/churnRiskEpisode.repository';
import { StudentAccessPlanRepository } from '@/repositories/academia/studentAccessPlan.repository';
import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { InvoicesRepository } from '@/repositories/billing/invoices.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { MealsRepository } from '@/repositories/food-diary/meals.repository';
import { WaterLogRepository } from '@/repositories/food-diary/waterLog.repository';
import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { PrismaService } from '@/database/prisma.service';
import { Clock } from '@/scheduling/clock.service';
import { Module } from '@nestjs/common';
import { ChurnRiskController } from './churnRisk.controller';
import { ChurnRiskCronService } from './churnRiskCron.service';
import { ChurnRiskEvaluationService } from './churnRiskEvaluation.service';
import { IndependentChurnRiskController } from './independentChurnRisk.controller';

// Own domain folder (ADR-006), sibling to engajamento/checkin: owns the new
// ChurnRiskEpisode table, the cron and the dismiss endpoint. Exports
// ChurnRiskEpisodeRepository so EngajamentoService (AcademiaModule) and the
// educator/nutritionist dashboards (churn-risk-alert-independent ADR-006)
// can inject it for their own dismissed-client filters. The billing/fixed-
// times/food-diary repositories below are additive (churn-risk-alert-
// independent): needed only by evaluateProfessional, never by
// evaluateAcademia.
@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [ChurnRiskController, IndependentChurnRiskController],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    CheckInRepository,
    StudentAccessPlanRepository,
    AcademiaRepository,
    ChurnRiskEpisodeRepository,
    FixedTimesRepository,
    MealsRepository,
    WaterLogRepository,
    BillingAccountRepository,
    InvoicesRepository,
    Clock,
    ChurnRiskEvaluationService,
    ChurnRiskCronService,
  ],
  exports: [ChurnRiskEpisodeRepository],
})
export class ChurnRiskModule {}
