import { brtDateKey } from '@/utils/brtDate';
import type { MonthlyWeightPoint } from '@/repositories/progress/measurementRecords.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

export const NO_DIARY_ENTRY_THRESHOLD_DAYS = 10;
export const NO_DIARY_ENTRY_ALERT_CAP = 50;
export const COMPLIANT_THRESHOLD = 0.7;
export const STRUGGLING_THRESHOLD = 0.3;

export type AdherenceBucket =
  | 'compliant'
  | 'struggling'
  | 'nonAdherent'
  | 'noDataYet';

export interface PatientBucketEntry {
  clientId: string;
  clientName: string;
  daysSinceLastEntry: number | null;
  loggedDayRatio: number | null;
}

export interface PatientAdherenceEntry extends PatientBucketEntry {
  bucket: AdherenceBucket;
  /** Whether this patient is currently eligible for the no-diary-entry alert
   * (churn-risk-alert-independent ADR-007) — computed once here via
   * isNoDiaryEntry, so computeNoDiaryEntryAlerts never re-derives it. Not
   * part of PatientBucketEntry: never leaked to the frontend contract. */
  noDiaryEntryEligible: boolean;
}

export interface PatientAdherenceInput {
  clientId: string;
  clientName: string;
  /** When this patient relationship began — the grace-period anchor for a
   * patient who has never logged anything yet (churn-risk-alert-independent
   * ADR-007), mirroring the educator dashboard's own createdAt fallback. */
  createdAt: Date;
  /** Every Meal.loggedAt this patient has ever logged. */
  mealLoggedDates: Date[];
  /** max(last Meal.loggedAt, last WaterLog.date); null if neither exists. */
  lastEntryAt: Date | null;
  /** The active published plan's publishedAt, or — when no plan exists but
   * diary history does — the earliest diary entry date; null when neither
   * exists (UT-033, excluded into 'noDataYet'). */
  since: Date | null;
}

export interface PortfolioEvolutionPoint {
  monthsInCare: number;
  avgPercentChangeFromStart: number;
  contributingPatientCount: number;
}

function daysSince(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / DAY_MS);
}

/** The date NO_DIARY_ENTRY is measured from: the patient's last diary entry,
 * or their relationship's own creation date when they have never logged
 * (churn-risk-alert-independent ADR-007) — the same grace-period shape as
 * the educator dashboard's referenceContactDate. */
export function referenceDiaryDate(
  patient: { id: string; createdAt: Date },
  lastEntryByPatient: Map<string, Date>,
): Date {
  return lastEntryByPatient.get(patient.id) ?? patient.createdAt;
}

export function isNoDiaryEntry(
  patient: { id: string; createdAt: Date },
  now: Date,
  lastEntryByPatient: Map<string, Date>,
): boolean {
  const reference = referenceDiaryDate(patient, lastEntryByPatient);
  return daysSince(reference, now) >= NO_DIARY_ENTRY_THRESHOLD_DAYS;
}

/** Classifies one patient's diary adherence (`since` → `now`) and no-entry
 * staleness in one pass, so both views share one canonical per-patient
 * record (UT-030–036). */
export function computePatientAdherence(
  input: PatientAdherenceInput,
  now: Date,
): PatientAdherenceEntry {
  const daysSinceLastEntry = input.lastEntryAt
    ? daysSince(input.lastEntryAt, now)
    : null;
  const lastEntryByPatient = new Map(
    input.lastEntryAt ? [[input.clientId, input.lastEntryAt]] : [],
  );
  const noDiaryEntryEligible = isNoDiaryEntry(
    { id: input.clientId, createdAt: input.createdAt },
    now,
    lastEntryByPatient,
  );

  if (input.since === null) {
    return {
      clientId: input.clientId,
      clientName: input.clientName,
      bucket: 'noDataYet',
      loggedDayRatio: null,
      daysSinceLastEntry,
      noDiaryEntryEligible,
    };
  }

  const elapsedDays = Math.max(
    1,
    Math.ceil((now.getTime() - input.since.getTime()) / DAY_MS),
  );
  const loggedDays = new Set(
    input.mealLoggedDates
      .filter(
        (date) =>
          date.getTime() >= input.since!.getTime() &&
          date.getTime() <= now.getTime(),
      )
      .map((date) => brtDateKey(date)),
  ).size;
  const ratio = loggedDays / elapsedDays;
  const bucket: AdherenceBucket =
    ratio >= COMPLIANT_THRESHOLD
      ? 'compliant'
      : ratio >= STRUGGLING_THRESHOLD
        ? 'struggling'
        : 'nonAdherent';

  return {
    clientId: input.clientId,
    clientName: input.clientName,
    bucket,
    loggedDayRatio: Math.round(ratio * 1000) / 1000,
    daysSinceLastEntry,
    noDiaryEntryEligible,
  };
}

function toBucketEntry(entry: PatientAdherenceEntry): PatientBucketEntry {
  return {
    clientId: entry.clientId,
    clientName: entry.clientName,
    daysSinceLastEntry: entry.daysSinceLastEntry,
    loggedDayRatio: entry.loggedDayRatio,
  };
}

export function groupIntoBuckets(entries: PatientAdherenceEntry[]): {
  compliant: PatientBucketEntry[];
  struggling: PatientBucketEntry[];
  nonAdherent: PatientBucketEntry[];
  noDataYet: PatientBucketEntry[];
} {
  const compliant: PatientBucketEntry[] = [];
  const struggling: PatientBucketEntry[] = [];
  const nonAdherent: PatientBucketEntry[] = [];
  const noDataYet: PatientBucketEntry[] = [];
  for (const entry of entries) {
    const bucketEntry = toBucketEntry(entry);
    if (entry.bucket === 'compliant') compliant.push(bucketEntry);
    else if (entry.bucket === 'struggling') struggling.push(bucketEntry);
    else if (entry.bucket === 'nonAdherent') nonAdherent.push(bucketEntry);
    else noDataYet.push(bucketEntry);
  }
  return { compliant, struggling, nonAdherent, noDataYet };
}

/** Stale or never-logged patients, capped at 50 (ADR-008); a patient who
 * never logged anything (`daysSinceLastEntry: null`) is the most urgent
 * case and sorts first (UT-035/UT-036). Eligibility (`noDiaryEntryEligible`)
 * is `isNoDiaryEntry`'s own precomputed verdict (churn-risk-alert-
 * independent ADR-007) — a patient younger than the threshold with nothing
 * logged yet is excluded, the same grace period the educator dashboard's
 * no-contact-alert list already has. */
export function computeNoDiaryEntryAlerts(
  entries: PatientAdherenceEntry[],
): PatientBucketEntry[] {
  return entries
    .filter((entry) => entry.noDiaryEntryEligible)
    .sort(
      (a, b) =>
        (b.daysSinceLastEntry ?? Infinity) - (a.daysSinceLastEntry ?? Infinity),
    )
    .slice(0, NO_DIARY_ENTRY_ALERT_CAP)
    .map(toBucketEntry);
}

export const OVERDUE_PAYMENT_ALERT_CAP = 50;

export interface OverduePaymentAlertEntry {
  clientId: string;
  clientName: string;
}

/** Patients with an overdue invoice, capped the same way every other alert
 * list in this project is (ADR-008) — mirrors educatorDashboardAggregation
 * .util.ts's OVERDUE_PAYMENT surfacing, extended to Nutricionista for the
 * first time (churn-risk-alert-independent TechSpec § API Endpoints). `[]`
 * when billing isn't connected — never a default-flagged guess. */
export function computeOverduePaymentAlerts(
  patients: { id: string; name: string }[],
  overdueClientIds: Set<string>,
  billingAvailable: boolean,
): OverduePaymentAlertEntry[] {
  if (!billingAvailable) return [];
  return patients
    .filter((patient) => overdueClientIds.has(patient.id))
    .slice(0, OVERDUE_PAYMENT_ALERT_CAP)
    .map((patient) => ({ clientId: patient.id, clientName: patient.name }));
}

/** Whole calendar months between `clientCreatedAt` and the first day of
 * (`year`, `month`) — the relative "months in care" bucket (ADR-009). */
export function computeMonthsInCare(
  clientCreatedAt: Date,
  year: number,
  month: number,
): number {
  const createdYear = clientCreatedAt.getUTCFullYear();
  const createdMonth = clientCreatedAt.getUTCMonth() + 1;
  return Math.max(0, (year - createdYear) * 12 + (month - createdMonth));
}

/** Normalizes each patient's monthly averages to a % change from their own
 * first data point, then averages that percent across patients sharing a
 * `monthsInCare` bucket (UT-037) — never fabricating a bucket a patient has
 * no data for (UT-040), and always reporting how many patients contributed
 * (UT-039). */
export function computePortfolioWeightEvolution(
  points: MonthlyWeightPoint[],
  clientCreatedAtByUserId: Map<string, Date>,
): PortfolioEvolutionPoint[] {
  const byUser = new Map<string, MonthlyWeightPoint[]>();
  for (const point of points) {
    const createdAt = clientCreatedAtByUserId.get(point.userId);
    if (!createdAt) continue;
    const existing = byUser.get(point.userId) ?? [];
    existing.push(point);
    byUser.set(point.userId, existing);
  }

  const percentChangesByBucket = new Map<number, number[]>();
  for (const [userId, userPoints] of byUser) {
    const createdAt = clientCreatedAtByUserId.get(userId)!;
    const sorted = [...userPoints].sort(
      (a, b) => a.year - b.year || a.month - b.month,
    );
    const startWeight = sorted[0].avgWeightKg;
    if (startWeight === 0) continue;
    for (const point of sorted) {
      const monthsInCare = computeMonthsInCare(
        createdAt,
        point.year,
        point.month,
      );
      const percentChange =
        ((point.avgWeightKg - startWeight) / startWeight) * 100;
      const bucket = percentChangesByBucket.get(monthsInCare) ?? [];
      bucket.push(percentChange);
      percentChangesByBucket.set(monthsInCare, bucket);
    }
  }

  return [...percentChangesByBucket.entries()]
    .sort(([a], [b]) => a - b)
    .map(([monthsInCare, changes]) => ({
      monthsInCare,
      avgPercentChangeFromStart:
        Math.round(
          (changes.reduce((sum, value) => sum + value, 0) / changes.length) *
            10,
        ) / 10,
      contributingPatientCount: changes.length,
    }));
}
