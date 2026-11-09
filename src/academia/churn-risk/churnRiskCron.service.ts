import { AcademiaRepository } from '@/repositories/academia/academia.repository';
import { Clock } from '@/scheduling/clock.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/node';
import { ChurnRiskEvaluationService } from './churnRiskEvaluation.service';

export interface ChurnRiskRunSummary {
  academias: number;
  notified: number;
  failed: number;
}

// Daily, matching this codebase's existing cadence precedent
// (FixedSessionsRenewalService, TurmaSessionsRenewalService: '0 3 * * *' BRT).
@Injectable()
export class ChurnRiskCronService {
  private readonly logger = new Logger(ChurnRiskCronService.name);

  constructor(
    private readonly academias: AcademiaRepository,
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

    const summary: ChurnRiskRunSummary = {
      academias: academiaIds.length,
      notified,
      failed,
    };
    this.logger.log(
      `churn_risk_run_completed academias=${summary.academias} notified=${summary.notified} failed=${summary.failed}`,
    );
    return summary;
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
