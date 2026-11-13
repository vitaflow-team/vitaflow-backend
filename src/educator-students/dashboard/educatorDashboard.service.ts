import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import {
  InvoicesRepository,
  type RevenueGroup,
} from '@/repositories/billing/invoices.repository';
import { ChurnRiskEpisodeRepository } from '@/repositories/academia/churnRiskEpisode.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { Injectable, Logger } from '@nestjs/common';
import { ChurnRiskReason, InvoiceStatus } from '@prisma/client';
import {
  computeCounters,
  computeNoContactAlerts,
  computeRiskRanking,
  type Counters,
  type StudentRiskEntry,
} from './educatorDashboardAggregation.util';

export interface RevenueSeriesPoint {
  clientId: string;
  clientName: string;
  year: number;
  month: number;
  amountCents: number;
}

export interface EducatorDashboardSummary {
  counters: Counters;
  riskRanking: StudentRiskEntry[];
  revenueByStudentMonth: RevenueSeriesPoint[];
  noContactAlerts: StudentRiskEntry[];
}

interface BillingData {
  billingAvailable: boolean;
  overdueClientIds: Set<string>;
  revenueByStudentMonth: RevenueSeriesPoint[];
}

@Injectable()
export class EducatorDashboardService {
  private readonly logger = new Logger(EducatorDashboardService.name);

  constructor(
    private readonly clients: ClientsRepository,
    private readonly fixedTimes: FixedTimesRepository,
    private readonly billingAccounts: BillingAccountRepository,
    private readonly invoices: InvoicesRepository,
    private readonly churnRiskEpisodes: ChurnRiskEpisodeRepository,
  ) {}

  async getDashboard(
    professionalId: string,
    now: Date,
  ): Promise<EducatorDashboardSummary> {
    const [students, lastContactByClient] = await Promise.all([
      this.clients.getAllByProfessionalId(professionalId),
      this.fixedTimes.findLatestNonCanceledByClient(professionalId),
    ]);
    const studentIds = students.map((student) => student.id);

    const [
      { billingAvailable, overdueClientIds, revenueByStudentMonth },
      dismissedContact,
      dismissedPayment,
    ] = await Promise.all([
      this.loadBillingData(professionalId, students),
      this.churnRiskEpisodes.findDismissedClientIdsByIds(
        studentIds,
        ChurnRiskReason.NO_CONTACT,
      ),
      this.churnRiskEpisodes.findDismissedClientIdsByIds(
        studentIds,
        ChurnRiskReason.OVERDUE_PAYMENT,
      ),
    ]);

    const isReasonDismissed = (
      entry: StudentRiskEntry,
      reason: 'NO_CONTACT' | 'OVERDUE_PAYMENT',
    ): boolean =>
      reason === 'NO_CONTACT'
        ? dismissedContact.has(entry.clientId)
        : dismissedPayment.has(entry.clientId);

    // Mirrors engajamento.service.ts's dismissed-student filter (ADR-010):
    // an entry drops off the list only once every reason it currently has
    // is individually dismissed — a client dismissed for NO_CONTACT who
    // later also starts OVERDUE_PAYMENT still shows, for that new reason.
    const riskRanking = computeRiskRanking(
      students,
      lastContactByClient,
      overdueClientIds,
      billingAvailable,
      now,
    ).filter(
      (entry) =>
        !entry.reasons.every((reason) => isReasonDismissed(entry, reason)),
    );

    return {
      counters: computeCounters(students, lastContactByClient, now),
      riskRanking,
      revenueByStudentMonth,
      noContactAlerts: computeNoContactAlerts(riskRanking).filter(
        (entry) => !dismissedContact.has(entry.clientId),
      ),
    };
  }

  /** Degrades to `billingAvailable: false` (no default-flagged overdue risk,
   * no revenue points) both when the professional has no connected billing
   * account and when the billing lookup itself fails (UT-046) — counters
   * and risk ranking are computed either way. */
  private async loadBillingData(
    professionalId: string,
    students: { id: string; name: string }[],
  ): Promise<BillingData> {
    try {
      const account =
        await this.billingAccounts.findActiveByUser(professionalId);
      if (!account) {
        return {
          billingAvailable: false,
          overdueClientIds: new Set(),
          revenueByStudentMonth: [],
        };
      }

      const [openInvoices, revenueGroups] = await Promise.all([
        this.invoices.findOpenByAccount(account.id),
        this.invoices.sumAmountByStudentAndMonth(account.id),
      ]);
      const overdueClientIds = new Set(
        openInvoices
          .filter((invoice) => invoice.status === InvoiceStatus.OVERDUE)
          .map((invoice) => invoice.clientId),
      );
      const revenueByStudentMonth = await this.buildRevenueSeries(
        revenueGroups,
        students,
      );

      return {
        billingAvailable: true,
        overdueClientIds,
        revenueByStudentMonth,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to load billing data for professional ${professionalId}: ${String(error)}`,
      );
      return {
        billingAvailable: false,
        overdueClientIds: new Set(),
        revenueByStudentMonth: [],
      };
    }
  }

  /** `revenueGroups` may reference a client no longer in the professional's
   * current portfolio (UT-026) — their name is looked up individually since
   * they're absent from the already-fetched `students` list. */
  private async buildRevenueSeries(
    revenueGroups: RevenueGroup[],
    students: { id: string; name: string }[],
  ): Promise<RevenueSeriesPoint[]> {
    const nameByClientId = new Map(students.map((s) => [s.id, s.name]));
    const missingIds = [
      ...new Set(revenueGroups.map((group) => group.clientId)),
    ].filter((id) => !nameByClientId.has(id));

    if (missingIds.length > 0) {
      const historicalClients = await Promise.all(
        missingIds.map((id) => this.clients.getClientById(id)),
      );
      for (const client of historicalClients) {
        if (client) nameByClientId.set(client.id, client.name);
      }
    }

    return revenueGroups.map((group) => ({
      clientId: group.clientId,
      clientName: nameByClientId.get(group.clientId) ?? '',
      year: group.year,
      month: group.month,
      amountCents: group.amountCents,
    }));
  }
}
