import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { InvoicesRepository } from '@/repositories/billing/invoices.repository';
import { ChurnRiskEpisodeRepository } from '@/repositories/academia/churnRiskEpisode.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { MealPlansRepository } from '@/repositories/meal-plans/mealPlans.repository';
import { MealsRepository } from '@/repositories/food-diary/meals.repository';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { WaterLogRepository } from '@/repositories/food-diary/waterLog.repository';
import { Injectable, Logger } from '@nestjs/common';
import { Client, ChurnRiskReason, InvoiceStatus } from '@prisma/client';
import {
  computeNoDiaryEntryAlerts,
  computeOverduePaymentAlerts,
  computePatientAdherence,
  computePortfolioWeightEvolution,
  groupIntoBuckets,
  type OverduePaymentAlertEntry,
  type PatientAdherenceEntry,
  type PatientBucketEntry,
  type PortfolioEvolutionPoint,
} from './nutritionistDashboardAggregation.util';

export interface NutritionistDashboardSummary {
  adherenceBuckets: {
    compliant: PatientBucketEntry[];
    struggling: PatientBucketEntry[];
    nonAdherent: PatientBucketEntry[];
    noDataYet: PatientBucketEntry[];
  };
  noDiaryEntryAlerts: PatientBucketEntry[];
  overduePaymentAlerts: OverduePaymentAlertEntry[];
  portfolioWeightEvolution: PortfolioEvolutionPoint[];
}

interface BillingData {
  billingAvailable: boolean;
  overdueClientIds: Set<string>;
}

@Injectable()
export class NutritionistDashboardService {
  private readonly logger = new Logger(NutritionistDashboardService.name);

  constructor(
    private readonly clients: ClientsRepository,
    private readonly meals: MealsRepository,
    private readonly waterLogs: WaterLogRepository,
    private readonly mealPlans: MealPlansRepository,
    private readonly measurementRecords: MeasurementRecordsRepository,
    private readonly billingAccounts: BillingAccountRepository,
    private readonly invoices: InvoicesRepository,
    private readonly churnRiskEpisodes: ChurnRiskEpisodeRepository,
  ) {}

  async getDashboard(
    professionalId: string,
    now: Date,
  ): Promise<NutritionistDashboardSummary> {
    const patients = await this.clients.getAllByProfessionalId(professionalId);
    const patientIds = patients.map((patient) => patient.id);

    const [
      entries,
      { billingAvailable, overdueClientIds },
      dismissedDiary,
      dismissedPayment,
    ] = await Promise.all([
      Promise.all(
        patients.map((patient) => this.evaluatePatient(patient, now)),
      ),
      this.loadBillingData(professionalId),
      this.churnRiskEpisodes.findDismissedClientIdsByIds(
        patientIds,
        ChurnRiskReason.NO_DIARY_ENTRY,
      ),
      this.churnRiskEpisodes.findDismissedClientIdsByIds(
        patientIds,
        ChurnRiskReason.OVERDUE_PAYMENT,
      ),
    ]);

    const linkedPatients = patients.filter((patient) => patient.userId);
    const points =
      linkedPatients.length === 0
        ? []
        : await this.measurementRecords.aggregateByClientAndMonth(
            linkedPatients.map((patient) => patient.userId as string),
          );
    const createdAtByUserId = new Map(
      linkedPatients.map((patient) => [
        patient.userId as string,
        patient.createdAt,
      ]),
    );

    return {
      adherenceBuckets: groupIntoBuckets(entries),
      noDiaryEntryAlerts: computeNoDiaryEntryAlerts(entries).filter(
        (entry) => !dismissedDiary.has(entry.clientId),
      ),
      overduePaymentAlerts: computeOverduePaymentAlerts(
        patients,
        overdueClientIds,
        billingAvailable,
      ).filter((entry) => !dismissedPayment.has(entry.clientId)),
      portfolioWeightEvolution: computePortfolioWeightEvolution(
        points,
        createdAtByUserId,
      ),
    };
  }

  /** Degrades to `billingAvailable: false` both when the professional has no
   * connected billing account and when the lookup itself fails — mirrors
   * educatorDashboard.service.ts's loadBillingData exactly. */
  private async loadBillingData(professionalId: string): Promise<BillingData> {
    try {
      const account =
        await this.billingAccounts.findActiveByUser(professionalId);
      if (!account) {
        return { billingAvailable: false, overdueClientIds: new Set() };
      }
      const openInvoices = await this.invoices.findOpenByAccount(account.id);
      const overdueClientIds = new Set(
        openInvoices
          .filter((invoice) => invoice.status === InvoiceStatus.OVERDUE)
          .map((invoice) => invoice.clientId),
      );
      return { billingAvailable: true, overdueClientIds };
    } catch (error) {
      this.logger.warn(
        `Failed to load billing data for professional ${professionalId}: ${String(error)}`,
      );
      return { billingAvailable: false, overdueClientIds: new Set() };
    }
  }

  /** Degrades per-patient (excludes them, logs a warning) rather than
   * failing the whole response if this patient's meal-plan lookup errors
   * (UT-047). */
  private async evaluatePatient(
    patient: Client,
    now: Date,
  ): Promise<PatientAdherenceEntry> {
    try {
      const userId = patient.userId;
      const [meals, waterLogs, publishedPlan] = await Promise.all([
        userId
          ? this.meals.findByUserForProfessional(userId)
          : Promise.resolve([]),
        userId
          ? this.waterLogs.findByUserForProfessional(userId)
          : Promise.resolve([]),
        this.mealPlans.findLatestPublished(patient.id),
      ]);

      // `findByUserForProfessional` sorts newest first (loggedAt/date desc).
      const mealLoggedDates = meals.map((meal) => meal.loggedAt);
      const lastMeal = meals[0]?.loggedAt ?? null;
      const earliestMeal = mealLoggedDates.at(-1) ?? null;
      const lastWaterLog = waterLogs[0]?.date ?? null;
      const earliestWaterLog = waterLogs.at(-1)?.date ?? null;

      const lastEntryAt = this.maxDate(lastMeal, lastWaterLog);
      const since =
        publishedPlan?.publishedAt ??
        this.earliestDate(earliestMeal, earliestWaterLog);

      return computePatientAdherence(
        {
          clientId: patient.id,
          clientName: patient.name,
          createdAt: patient.createdAt,
          mealLoggedDates,
          lastEntryAt,
          since,
        },
        now,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to evaluate adherence for patient ${patient.id}: ${String(error)}`,
      );
      // Degrades safely (churn-risk-alert-independent): a failed evaluation
      // never becomes alert-eligible on its own.
      return {
        clientId: patient.id,
        clientName: patient.name,
        bucket: 'noDataYet',
        loggedDayRatio: null,
        daysSinceLastEntry: null,
        noDiaryEntryEligible: false,
      };
    }
  }

  private maxDate(a: Date | null, b: Date | null): Date | null {
    if (!a) return b;
    if (!b) return a;
    return a.getTime() >= b.getTime() ? a : b;
  }

  /** Earliest diary signal of either kind, used as the adherence-window
   * anchor only when no published meal plan exists yet. */
  private earliestDate(a: Date | null, b: Date | null): Date | null {
    if (!a) return b;
    if (!b) return a;
    return a.getTime() <= b.getTime() ? a : b;
  }
}
