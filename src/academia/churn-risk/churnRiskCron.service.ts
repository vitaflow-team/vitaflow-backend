import { AcademiaRepository } from '@/repositories/academia/academia.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProductType } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { ChurnRiskEvaluationService } from './churnRiskEvaluation.service';

export interface ChurnRiskRunSummary {
  academias: number;
  notified: number;
  failed: number;
  // Independent-professional loop (churn-risk-alert-independent ADR-005) —
  // counted separately from the academia counts above, which keep their
  // original meaning unchanged.
  professionals: number;
  professionalsNotified: number;
  professionalsFailed: number;
}

// Daily, matching this codebase's existing cadence precedent
// (FixedSessionsRenewalService, TurmaSessionsRenewalService: '0 3 * * *' BRT).
@Injectable()
export class ChurnRiskCronService {
  private readonly logger = new Logger(ChurnRiskCronService.name);

  constructor(
    private readonly academias: AcademiaRepository,
    private readonly clients: ClientsRepository,
    private readonly users: UserRepository,
    private readonly evaluation: ChurnRiskEvaluationService,
    private readonly clock: Clock,
  ) {}

  @Cron('0 3 * * *', { timeZone: 'America/Sao_Paulo' })
  async run(): Promise<ChurnRiskRunSummary> {
    const now = this.clock.now();
    const academiaIds = await this.academias.findIdsWithStudents();

    let notified = 0;
    let failed = 0;
    for (const academiaId of academiaIds) {
      const outcome = await this.evaluateOne(academiaId, now);
      notified += outcome.notified;
      if (outcome.failed) failed += 1;
    }

    const {
      professionals,
      notified: professionalsNotified,
      failed: professionalsFailed,
    } = await this.runProfessionalLoop(now);

    const summary: ChurnRiskRunSummary = {
      academias: academiaIds.length,
      notified,
      failed,
      professionals,
      professionalsNotified,
      professionalsFailed,
    };
    this.logger.log(
      `churn_risk_run_completed academias=${summary.academias} notified=${summary.notified} failed=${summary.failed} ` +
        `professionals=${summary.professionals} professionalsNotified=${summary.professionalsNotified} professionalsFailed=${summary.professionalsFailed}`,
    );
    return summary;
  }

  // Independent-professional loop (churn-risk-alert-independent ADR-005) —
  // runs after the academia loop above, which it never touches or depends
  // on. Same per-item fault isolation as evaluateOne below.
  private async runProfessionalLoop(now: Date): Promise<{
    professionals: number;
    notified: number;
    failed: number;
  }> {
    const professionalIds =
      await this.clients.findProfessionalIdsWithPrivateClients();
    const typesById = await this.users.findProductTypesByIds(professionalIds);

    let notified = 0;
    let failed = 0;
    for (const professionalId of professionalIds) {
      const productType = typesById.get(professionalId);
      if (
        productType !== ProductType.PHYSICAL_EDUCATOR &&
        productType !== ProductType.NUTRITIONIST
      ) {
        // No resolvable product (e.g. a deleted/product-less account) —
        // never evaluated, never counted as a failure.
        continue;
      }
      const outcome = await this.evaluateOneProfessional(
        professionalId,
        productType,
        now,
      );
      if (outcome.notified) notified += 1;
      if (outcome.failed) failed += 1;
    }

    return { professionals: professionalIds.length, notified, failed };
  }

  private async evaluateOneProfessional(
    professionalId: string,
    productType:
      | typeof ProductType.PHYSICAL_EDUCATOR
      | typeof ProductType.NUTRITIONIST,
    now: Date,
  ): Promise<{ notified: boolean; failed: boolean }> {
    try {
      const result = await this.evaluation.evaluateProfessional(
        professionalId,
        productType,
        now,
      );
      return { notified: result.notified, failed: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `churn_risk_professional_failed professionalId=${professionalId} error=${message}`,
      );
      Sentry.captureException(error);
      return { notified: false, failed: true };
    }
  }

  // Per-academia fault isolation (ADR-007) — a DELIBERATE DEVIATION from
  // this codebase's 3 other cron precedents (ViewAsRetentionPurgeCron,
  // FixedSessionsRenewalService.runRenewal, TurmaSessionsRenewalService.
  // runRenewal), none of which isolate failure per item: a thrown error
  // evaluating one academia must never abort the remaining academias in
  // this run. Caught locally, it will never reach SentryExceptionFilter on
  // its own, so it's forwarded to Sentry explicitly here.
  private async evaluateOne(
    academiaId: string,
    now: Date,
  ): Promise<{ notified: number; failed: boolean }> {
    try {
      const result = await this.evaluation.evaluateAcademia(academiaId, now);
      return { notified: result.notificationsSent, failed: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `churn_risk_academia_failed academiaId=${academiaId} error=${message}`,
      );
      Sentry.captureException(error);
      return { notified: 0, failed: true };
    }
  }
}
