import { AuthModule } from '@/auth/auth.module';
import { NotificationsModule } from '@/notifications/notifications.module';
import { AcademiaRepository } from '@/repositories/academia/academia.repository';
import { CheckInRepository } from '@/repositories/academia/checkIn.repository';
import { ChurnRiskEpisodeRepository } from '@/repositories/academia/churnRiskEpisode.repository';
import { StudentAccessPlanRepository } from '@/repositories/academia/studentAccessPlan.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { PrismaService } from '@/database/prisma.service';
import { Clock } from '@/scheduling/clock.service';
import { Module } from '@nestjs/common';
import { ChurnRiskController } from './churnRisk.controller';
import { ChurnRiskCronService } from './churnRiskCron.service';
import { ChurnRiskEvaluationService } from './churnRiskEvaluation.service';

// Own domain folder (ADR-006), sibling to engajamento/checkin: owns the new
// ChurnRiskEpisode table, the cron and the dismiss endpoint. Exports
// ChurnRiskEpisodeRepository so EngajamentoService (AcademiaModule) can
// inject it for the dashboard's dismissed-student filter (ADR-010).
@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [ChurnRiskController],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    CheckInRepository,
    StudentAccessPlanRepository,
    AcademiaRepository,
    ChurnRiskEpisodeRepository,
    Clock,
    ChurnRiskEvaluationService,
    ChurnRiskCronService,
  ],
  exports: [ChurnRiskEpisodeRepository],
})
export class ChurnRiskModule {}
