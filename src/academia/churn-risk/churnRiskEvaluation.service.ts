import { computeAtRisk } from '@/academia/engajamento/engajamentoAggregation.util';
import { NotificationsService } from '@/notifications/notifications.service';
import { AcademiaRepository } from '@/repositories/academia/academia.repository';
import { CheckInRepository } from '@/repositories/academia/checkIn.repository';
import { ChurnRiskEpisodeRepository } from '@/repositories/academia/churnRiskEpisode.repository';
import { StudentAccessPlanRepository } from '@/repositories/academia/studentAccessPlan.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { appUrl } from '@/scheduling/schedulingFormat.util';
import { Injectable, Logger } from '@nestjs/common';
import {
  ChurnRiskEpisode,
  ChurnRiskReason,
  NotificationCategory,
} from '@prisma/client';

const CHURN_RISK_DASHBOARD_LINK = '/restrict/academia-engajamento';

export interface ChurnRiskEvaluationResult {
  newEpisodes: number;
  recoveredEpisodes: number;
  notificationsSent: number; // 0 during an academia's baseline run (ADR-005)
}

interface StudentRiskState {
  clientId: string;
  name: string;
  reasons: Set<ChurnRiskReason>;
}

function reasonLabel(reason: ChurnRiskReason): string {
  return reason === ChurnRiskReason.CHECK_IN_INACTIVITY
    ? 'sem check-in recente'
    : 'plano de acesso vencido/esgotado';
}

function buildMessage(studentName: string, reasons: ChurnRiskReason[]): string {
  const labels = reasons.map(reasonLabel).join(' e ');
  return `${studentName} está em risco de evasão (${labels}).`;
}

@Injectable()
export class ChurnRiskEvaluationService {
  private readonly logger = new Logger(ChurnRiskEvaluationService.name);

  constructor(
    private readonly episodes: ChurnRiskEpisodeRepository,
    private readonly academias: AcademiaRepository,
    private readonly checkIns: CheckInRepository,
    private readonly plans: StudentAccessPlanRepository,
    private readonly clients: ClientsRepository,
    private readonly users: UserRepository,
    private readonly notifications: NotificationsService,
  ) {}

  async evaluateAcademia(
    academiaId: string,
    now: Date,
  ): Promise<ChurnRiskEvaluationResult> {
    const baselineAt = await this.academias.findChurnRiskBaselineAt(academiaId);
    const isBaseline = baselineAt === null;

    const currentStates = await this.computeCurrentStates(academiaId, now);
    const openEpisodes = await this.episodes.findOpenByAcademia(academiaId);

    const recoveredEpisodes = await this.endRecovered(
      openEpisodes,
      currentStates,
      now,
    );
    const { newEpisodes, notificationsSent } = await this.createNewEpisodes({
      academiaId,
      currentStates,
      openEpisodes,
      isBaseline,
      now,
    });

    if (isBaseline) {
      await this.academias.markChurnRiskBaselined(academiaId, now);
    }

    return { newEpisodes, recoveredEpisodes, notificationsSent };
  }

  async dismissForClient(
    clientId: string,
    now: Date,
  ): Promise<{ dismissed: number }> {
    const dismissed = await this.episodes.dismissOpenForClient(clientId, now);
    return { dismissed };
  }

  private async computeCurrentStates(
    academiaId: string,
    now: Date,
  ): Promise<Map<string, StudentRiskState>> {
    const [students, lastCheckInByClient, planStatuses] = await Promise.all([
      this.clients.findAllGymStudentNames(academiaId),
      this.checkIns.findLastCheckInByClient(academiaId),
      this.plans.findStatusesByAcademia(academiaId, now),
    ]);

    const states = new Map<string, StudentRiskState>();
    for (const student of students) {
      states.set(student.id, {
        clientId: student.id,
        name: student.name,
        reasons: new Set(),
      });
    }
    for (const atRisk of computeAtRisk(students, lastCheckInByClient, now)) {
      states
        .get(atRisk.clientId)
        ?.reasons.add(ChurnRiskReason.CHECK_IN_INACTIVITY);
    }
    for (const planStatus of planStatuses) {
      if (
        planStatus.status === 'EXPIRED' ||
        planStatus.status === 'EXHAUSTED'
      ) {
        states
          .get(planStatus.clientId)
          ?.reasons.add(ChurnRiskReason.ACCESS_PLAN_LAPSED);
      }
    }
    return states;
  }

  // A no-longer-matching open episode recovers regardless of whether it was
  // dismissed (ADR-009: endedAt is independent of dismissedAt) — the next
  // relapse then starts a genuinely new, normally-notified episode (US-004).
  private async endRecovered(
    openEpisodes: ChurnRiskEpisode[],
    currentStates: Map<string, StudentRiskState>,
    now: Date,
  ): Promise<number> {
    let recovered = 0;
    for (const episode of openEpisodes) {
      const stillAtRisk = currentStates
        .get(episode.clientId)
        ?.reasons.has(episode.reason);
      if (!stillAtRisk) {
        await this.episodes.end(episode.id, now);
        recovered += 1;
      }
    }
    return recovered;
  }

  private async createNewEpisodes(params: {
    academiaId: string;
    currentStates: Map<string, StudentRiskState>;
    openEpisodes: ChurnRiskEpisode[];
    isBaseline: boolean;
    now: Date;
  }): Promise<{ newEpisodes: number; notificationsSent: number }> {
    const { academiaId, currentStates, openEpisodes, isBaseline, now } = params;
    const openByClientReason = new Set(
      openEpisodes.map((episode) => `${episode.clientId}|${episode.reason}`),
    );

    let newEpisodes = 0;
    let notificationsSent = 0;
    for (const state of currentStates.values()) {
      const newReasons = [...state.reasons].filter(
        (reason) => !openByClientReason.has(`${state.clientId}|${reason}`),
      );
      if (newReasons.length === 0) continue;

      if (!isBaseline) {
        await this.notifyOwner(academiaId, state, newReasons);
        notificationsSent += 1;
      }
      for (const reason of newReasons) {
        await this.episodes.create(state.clientId, reason, now);
        newEpisodes += 1;
      }
    }
    return { newEpisodes, notificationsSent };
  }

  // Mirrors AcademiaActivityService.recordActivity's exact owner-resolution
  // and try/catch shape: a notification failure never blocks this
  // academia's episode bookkeeping, and is only ever logged, not thrown.
  private async notifyOwner(
    academiaId: string,
    state: StudentRiskState,
    reasons: ChurnRiskReason[],
  ): Promise<void> {
    try {
      const owner = await this.users.findUnique({ academiaId });
      if (!owner) {
        this.logger.warn(`churn_risk_no_owner academiaId=${academiaId}`);
        return;
      }
      await this.notifications.create(
        owner.id,
        NotificationCategory.CHURN_RISK_ALERT,
        buildMessage(state.name, reasons),
        appUrl(CHURN_RISK_DASHBOARD_LINK),
      );
    } catch {
      this.logger.error(
        `churn_risk_notify_failed academiaId=${academiaId} clientId=${state.clientId}`,
      );
    }
  }
}
