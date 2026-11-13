const DAY_MS = 24 * 60 * 60 * 1000;

export const RISK_THRESHOLD_DAYS = 10;
export const RISK_RANKING_CAP = 50;

export type RiskReason = 'NO_CONTACT' | 'OVERDUE_PAYMENT';
export type RiskSeverity = 'YELLOW' | 'RED';

export interface StudentFixture {
  id: string;
  name: string;
  createdAt: Date;
}

export interface StudentRiskEntry {
  clientId: string;
  clientName: string;
  severity: RiskSeverity;
  reasons: RiskReason[];
  daysSinceLastContact: number | null;
  billingAvailable: boolean;
}

export interface Counters {
  activeCount: number;
  inactiveCount: number;
  totalCount: number;
}

function daysSince(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / DAY_MS);
}

/** The date NO_CONTACT is measured from: the last non-canceled session, or
 * the connection date when there has never been one (UT-021's grace period
 * anchor). Exported for direct reuse by the independent-professional
 * churn-risk evaluation path (churn-risk-alert-independent TechSpec § Core
 * Interfaces) — not just this file's own dashboard computation. */
export function referenceContactDate(
  student: StudentFixture,
  lastContactByClient: Map<string, Date>,
): Date {
  return lastContactByClient.get(student.id) ?? student.createdAt;
}

export function isNoContact(
  student: StudentFixture,
  lastContactByClient: Map<string, Date>,
  now: Date,
): boolean {
  const reference = referenceContactDate(student, lastContactByClient);
  return daysSince(reference, now) >= RISK_THRESHOLD_DAYS;
}

/** Active/inactive by schedule recency (UT-018), independent of the capped
 * risk ranking so it stays correct at any portfolio size (UT-023). */
export function computeCounters(
  students: StudentFixture[],
  lastContactByClient: Map<string, Date>,
  now: Date,
): Counters {
  const inactiveCount = students.filter((student) =>
    isNoContact(student, lastContactByClient, now),
  ).length;
  return {
    activeCount: students.length - inactiveCount,
    inactiveCount,
    totalCount: students.length,
  };
}

const SEVERITY_RANK: Record<RiskSeverity, number> = { RED: 0, YELLOW: 1 };

/** Every flagged student (GREEN omitted, UT-020), severity-sorted and capped
 * at 50 (ADR-008). `overdueClientIds`/`billingAvailable` are ignored when
 * billing isn't connected — no default OVERDUE_PAYMENT flag (UT-024). */
export function computeRiskRanking(
  students: StudentFixture[],
  lastContactByClient: Map<string, Date>,
  overdueClientIds: Set<string>,
  billingAvailable: boolean,
  now: Date,
): StudentRiskEntry[] {
  const entries: StudentRiskEntry[] = [];
  for (const student of students) {
    const lastContact = lastContactByClient.get(student.id) ?? null;
    const reasons: RiskReason[] = [];
    if (isNoContact(student, lastContactByClient, now)) {
      reasons.push('NO_CONTACT');
    }
    if (billingAvailable && overdueClientIds.has(student.id)) {
      reasons.push('OVERDUE_PAYMENT');
    }
    if (reasons.length === 0) continue;
    entries.push({
      clientId: student.id,
      clientName: student.name,
      severity: reasons.length >= 2 ? 'RED' : 'YELLOW',
      reasons,
      daysSinceLastContact: lastContact ? daysSince(lastContact, now) : null,
      billingAvailable,
    });
  }

  return entries
    .sort((a, b) => {
      const severityDiff =
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return (b.daysSinceLastContact ?? -1) - (a.daysSinceLastContact ?? -1);
    })
    .slice(0, RISK_RANKING_CAP);
}

/** Subset of the (already capped/sorted) risk ranking flagged NO_CONTACT,
 * re-sorted by days-since-contact alone (UT-028); `[]` when nobody
 * qualifies is itself the explicit "no one flagged" state (UT-029) — the
 * orchestration only ever reaches this call on the happy path, so an empty
 * array here can't be confused with a degraded/failed computation. */
export function computeNoContactAlerts(
  riskRanking: StudentRiskEntry[],
): StudentRiskEntry[] {
  return riskRanking
    .filter((entry) => entry.reasons.includes('NO_CONTACT'))
    .sort(
      (a, b) => (b.daysSinceLastContact ?? -1) - (a.daysSinceLastContact ?? -1),
    );
}
