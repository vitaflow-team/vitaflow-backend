import { computeAtRisk } from '@/academia/engajamento/engajamentoAggregation.util';
import {
  isNoContact,
  type StudentFixture,
} from '@/educator-students/dashboard/educatorDashboardAggregation.util';
import { isNoDiaryEntry } from '@/nutritionist-patients/dashboard/nutritionistDashboardAggregation.util';
import { NotificationsService } from '@/notifications/notifications.service';
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
import { appUrl } from '@/scheduling/schedulingFormat.util';
import { Injectable, Logger } from '@nestjs/common';
import {
  Client,
  ChurnRiskEpisode,
  ChurnRiskReason,
  InvoiceStatus,
  NotificationCategory,
  ProductType,
} from '@prisma/client';

const CHURN_RISK_DASHBOARD_LINK = '/restrict/academia-engajamento';

// Best-available guess, not confirmed against the frontend route constants
// (TechSpec § Known Risks) — role-management-dashboards' own dashboard
// widgets were framed as part of the existing student/patient list views,
// not a dedicated new page, so these point there pending confirmation.
const EDUCATOR_DASHBOARD_LINK = '/restrict/students';
const NUTRITIONIST_DASHBOARD_LINK = '/restrict/patients';

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

// Independent-professional reasons (churn-risk-alert-independent ADR-001).
function professionalReasonLabel(reason: ChurnRiskReason): string {
  switch (reason) {
    case ChurnRiskReason.NO_CONTACT:
      return 'sem contato recente';
    case ChurnRiskReason.NO_DIARY_ENTRY:
      return 'sem registro recente no diário';
    case ChurnRiskReason.OVERDUE_PAYMENT:
      return 'pagamento em atraso';
    default:
      return reason;
  }
}

function buildProfessionalMessage(
  clientName: string,
  reasons: ChurnRiskReason[],
): string {
  const labels = reasons.map(professionalReasonLabel).join(' e ');
  return `${clientName} está em risco de evasão (${labels}).`;
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
    private readonly fixedTimes: FixedTimesRepository,
    private readonly meals: MealsRepository,
    private readonly waterLogs: WaterLogRepository,
    private readonly billingAccounts: BillingAccountRepository,
    private readonly invoices: InvoicesRepository,
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

  // Sibling to evaluateAcademia (churn-risk-alert-independent ADR-005) —
  // evaluateAcademia itself is never called or modified by this method.
  async evaluateProfessional(
    professionalId: string,
    productType:
      | typeof ProductType.PHYSICAL_EDUCATOR
      | typeof ProductType.NUTRITIONIST,
    now: Date,
  ): Promise<{ notified: boolean }> {
    const baselineAt =
      await this.users.findIndependentChurnRiskBaselineAt(professionalId);
    const isBaseline = baselineAt === null;

    // academiaId: null only — a gym-assigned educator's students carry
    // professionalId too and must never be evaluated here (TechSpec §
    // Core Interfaces).
    const privateClients =
      await this.clients.findPrivateClientsByProfessionalId(professionalId);

    let notificationsSent = 0;
    if (privateClients.length > 0) {
      const currentStates = await this.computeProfessionalStates(
        privateClients,
        productType,
        professionalId,
        now,
      );
      const clientIds = privateClients.map((client) => client.id);
      const openEpisodes = await this.episodes.findOpenByClientIds(clientIds);

      await this.endRecovered(openEpisodes, currentStates, now);
      const result = await this.createNewEpisodesForProfessional({
        professionalId,
        productType,
        currentStates,
        openEpisodes,
        isBaseline,
        now,
      });
      notificationsSent = result.notificationsSent;
    }

    if (isBaseline) {
      await this.users.markIndependentChurnRiskBaselined(professionalId, now);
    }

    return { notified: notificationsSent > 0 };
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

  // Mirrors computeCurrentStates's shape, scoped to a professional's private
  // clients instead of an academia's students (churn-risk-alert-independent
  // ADR-001): the type-specific inactivity reason plus overdue payment.
  private async computeProfessionalStates(
    privateClients: Client[],
    productType:
      | typeof ProductType.PHYSICAL_EDUCATOR
      | typeof ProductType.NUTRITIONIST,
    professionalId: string,
    now: Date,
  ): Promise<Map<string, StudentRiskState>> {
    const states = new Map<string, StudentRiskState>();
    for (const client of privateClients) {
      states.set(client.id, {
        clientId: client.id,
        name: client.name,
        reasons: new Set(),
      });
    }

    if (productType === ProductType.PHYSICAL_EDUCATOR) {
      const lastContactByClient =
        await this.fixedTimes.findLatestNonCanceledByClient(professionalId);
      for (const client of privateClients) {
        const fixture: StudentFixture = {
          id: client.id,
          name: client.name,
          createdAt: client.createdAt,
        };
        if (isNoContact(fixture, lastContactByClient, now)) {
          states.get(client.id)?.reasons.add(ChurnRiskReason.NO_CONTACT);
        }
      }
    } else {
      const lastEntryByPatient =
        await this.buildLastDiaryEntryMap(privateClients);
      for (const client of privateClients) {
        if (
          isNoDiaryEntry(
            { id: client.id, createdAt: client.createdAt },
            now,
            lastEntryByPatient,
          )
        ) {
          states.get(client.id)?.reasons.add(ChurnRiskReason.NO_DIARY_ENTRY);
        }
      }
    }

    const overdueClientIds = await this.loadOverdueClientIds(professionalId);
    for (const clientId of overdueClientIds) {
      states.get(clientId)?.reasons.add(ChurnRiskReason.OVERDUE_PAYMENT);
    }

    return states;
  }

  // Combines Meal + WaterLog last-entry dates per client, exactly the same
  // "last entry" definition nutritionistDashboard.service.ts's adherence
  // computation already uses, resolved through Client.userId (a patient
  // never linked to an app account has no diary data reachable at all).
  private async buildLastDiaryEntryMap(
    privateClients: Client[],
  ): Promise<Map<string, Date>> {
    const map = new Map<string, Date>();
    await Promise.all(
      privateClients.map(async (client) => {
        if (!client.userId) return;
        const [meals, waterLogs] = await Promise.all([
          this.meals.findByUserForProfessional(client.userId),
          this.waterLogs.findByUserForProfessional(client.userId),
        ]);
        const lastMeal = meals[0]?.loggedAt ?? null;
        const lastWaterLog = waterLogs[0]?.date ?? null;
        const last = this.maxDate(lastMeal, lastWaterLog);
        if (last) map.set(client.id, last);
      }),
    );
    return map;
  }

  private maxDate(a: Date | null, b: Date | null): Date | null {
    if (!a) return b;
    if (!b) return a;
    return a.getTime() >= b.getTime() ? a : b;
  }

  // Mirrors educatorDashboard.service.ts's loadBillingData exactly (minus
  // the revenue-series computation, irrelevant here): degrades to an empty
  // set both when there's no connected billing account and when the lookup
  // itself fails — never a default-flagged guess.
  private async loadOverdueClientIds(
    professionalId: string,
  ): Promise<Set<string>> {
    try {
      const account =
        await this.billingAccounts.findActiveByUser(professionalId);
      if (!account) return new Set();
      const openInvoices = await this.invoices.findOpenByAccount(account.id);
      return new Set(
        openInvoices
          .filter((invoice) => invoice.status === InvoiceStatus.OVERDUE)
          .map((invoice) => invoice.clientId),
      );
    } catch {
      return new Set();
    }
  }

  // Sibling to createNewEpisodes (churn-risk-alert-independent ADR-005) —
  // createNewEpisodes itself is never called or modified by this method.
  private async createNewEpisodesForProfessional(params: {
    professionalId: string;
    productType:
      | typeof ProductType.PHYSICAL_EDUCATOR
      | typeof ProductType.NUTRITIONIST;
    currentStates: Map<string, StudentRiskState>;
    openEpisodes: ChurnRiskEpisode[];
    isBaseline: boolean;
    now: Date;
  }): Promise<{ newEpisodes: number; notificationsSent: number }> {
    const {
      professionalId,
      productType,
      currentStates,
      openEpisodes,
      isBaseline,
      now,
    } = params;
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
        await this.notifyProfessional(
          professionalId,
          productType,
          state,
          newReasons,
        );
        notificationsSent += 1;
      }
      for (const reason of newReasons) {
        await this.episodes.create(state.clientId, reason, now);
        newEpisodes += 1;
      }
    }
    return { newEpisodes, notificationsSent };
  }

  private async notifyProfessional(
    professionalId: string,
    productType:
      | typeof ProductType.PHYSICAL_EDUCATOR
      | typeof ProductType.NUTRITIONIST,
    state: StudentRiskState,
    reasons: ChurnRiskReason[],
  ): Promise<void> {
    try {
      const link =
        productType === ProductType.NUTRITIONIST
          ? NUTRITIONIST_DASHBOARD_LINK
          : EDUCATOR_DASHBOARD_LINK;
      await this.notifications.create(
        professionalId,
        NotificationCategory.CHURN_RISK_ALERT,
        buildProfessionalMessage(state.name, reasons),
        appUrl(link),
      );
    } catch {
      this.logger.error(
        `churn_risk_notify_failed professionalId=${professionalId} clientId=${state.clientId}`,
      );
    }
  }
}
