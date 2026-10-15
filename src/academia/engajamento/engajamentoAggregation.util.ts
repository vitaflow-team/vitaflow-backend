import { brtDateKey } from '@/utils/brtDate';
import { CheckInSource } from '@prisma/client';

export const WEEKLY_LOOKBACK_DAYS = 28;
export const RISK_THRESHOLD_DAYS = 10;
export const RECENT_FEED_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CheckInFixture {
  clientId: string;
  createdAt: Date;
  source: CheckInSource;
  clientName: string;
  planValidAtCheckIn: boolean;
}

export interface StudentFixture {
  id: string;
  name: string;
}

export interface AtRiskStudent {
  clientId: string;
  name: string;
  lastCheckInAt: string | null;
}

export interface FeedEntry {
  clientId: string;
  name: string;
  createdAt: string;
  source: CheckInSource;
  planValidAtCheckIn: boolean;
}

/** The lookback window, clamped to the academia's own age (ADR-008/UT-017). */
export function resolveLookbackDays(
  academiaCreatedAt: Date,
  now: Date,
): number {
  const ageDays = Math.ceil(
    (now.getTime() - academiaCreatedAt.getTime()) / DAY_MS,
  );
  return Math.min(WEEKLY_LOOKBACK_DAYS, Math.max(1, ageDays));
}

/** Distinct students with a check-in today (BRT), not raw row count. */
export function computeTodayCount(
  checkIns: CheckInFixture[],
  now: Date,
): number {
  const todayKey = brtDateKey(now);
  return new Set(
    checkIns
      .filter((checkIn) => brtDateKey(checkIn.createdAt) === todayKey)
      .map((checkIn) => checkIn.clientId),
  ).size;
}

/** Distinct (clientId, BRT day) pairs over the window, per week, averaged
 * across every gym student — not just those with a check-in (ADR-008). */
export function computeWeeklyFrequency(
  checkIns: CheckInFixture[],
  lookbackDays: number,
  studentCount: number,
): number {
  if (studentCount === 0) return 0;
  const dayPairs = new Set(
    checkIns.map(
      (checkIn) => `${checkIn.clientId}|${brtDateKey(checkIn.createdAt)}`,
    ),
  );
  const weeks = lookbackDays / 7;
  return dayPairs.size / weeks / studentCount;
}

/** Every student 10+ BRT days since their last check-in, or never (UT-019) —
 * every gym student is a candidate, never only those with CheckIn rows. */
export function computeAtRisk(
  students: StudentFixture[],
  lastCheckInByClient: Map<string, Date>,
  now: Date,
): AtRiskStudent[] {
  return students
    .map((student) => ({
      clientId: student.id,
      name: student.name,
      lastCheckInAt: lastCheckInByClient.get(student.id) ?? null,
    }))
    .filter((student) => {
      if (!student.lastCheckInAt) return true;
      const daysSince = Math.floor(
        (now.getTime() - student.lastCheckInAt.getTime()) / DAY_MS,
      );
      return daysSince >= RISK_THRESHOLD_DAYS;
    })
    .map((student) => ({
      ...student,
      lastCheckInAt: student.lastCheckInAt
        ? student.lastCheckInAt.toISOString()
        : null,
    }));
}

/** Newest-first, bounded even at scale (UT-020/UT-021). */
export function computeRecentFeed(
  checkIns: CheckInFixture[],
  limit: number = RECENT_FEED_LIMIT,
): FeedEntry[] {
  return [...checkIns]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map((checkIn) => ({
      clientId: checkIn.clientId,
      name: checkIn.clientName,
      createdAt: checkIn.createdAt.toISOString(),
      source: checkIn.source,
      planValidAtCheckIn: checkIn.planValidAtCheckIn,
    }));
}
