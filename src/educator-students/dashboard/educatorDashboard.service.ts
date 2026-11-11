import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { InvoicesRepository } from '@/repositories/billing/invoices.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { Injectable, Logger } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
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
  ) {}

  async getDashboard(
    professionalId: string,
    now: Date,
  ): Promise<EducatorDashboardSummary> {
    const [students, lastContactByClient] = await Promise.all([
      this.clients.getAllByProfessionalId(professionalId),
      this.fixedTimes.findLatestNonCanceledByClient(professionalId),
    ]);

    const { billingAvailable, overdueClientIds, revenueByStudentMonth } =
      await this.loadBillingData(professionalId, students);

    const riskRanking = computeRiskRanking(
      students,
      lastContactByClient,
      overdueClientIds,
      billingAvailable,
      now,
    );

    return {
      counters: computeCounters(students, lastContactByClient, now),
      riskRanking,
      revenueByStudentMonth,
      noContactAlerts: computeNoContactAlerts(riskRanking),
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
    revenueGroups: {
      clientId: string;
      year: number;
      month: number;
      amountCents: number;
    }[],
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
