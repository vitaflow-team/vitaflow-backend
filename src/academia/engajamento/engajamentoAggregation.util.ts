import {
  BRT_OFFSET_MS,
  brtDateKey,
  brtHour,
  brtWeekday,
} from '@/utils/brtDate';
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

export interface HeatmapCell {
  weekday: number;
  hour: number;
  count: number;
}

export interface MonthOverMonth {
  currentMonthCount: number;
  previousMonthCount: number | null;
  isCurrentMonthPartial: boolean;
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

/** Zero-filled 7x24 (weekday x BRT hour) grid; never sparse (UT-041/UT-042). */
export function computeCheckInHeatmap(
  checkIns: CheckInFixture[],
): HeatmapCell[] {
  const grid: HeatmapCell[] = [];
  const byKey = new Map<string, HeatmapCell>();
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      const cell: HeatmapCell = { weekday, hour, count: 0 };
      grid.push(cell);
      byKey.set(`${weekday}|${hour}`, cell);
    }
  }
  for (const checkIn of checkIns) {
    const key = `${brtWeekday(checkIn.createdAt)}|${brtHour(checkIn.createdAt)}`;
    const cell = byKey.get(key);
    if (cell) cell.count += 1;
  }
  return grid;
}

/** BRT midnight on day 1 of the calendar month before `now`'s. */
export function resolvePreviousMonthStart(now: Date): Date {
  const [year, month] = brtDateKey(now).split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return new Date(
    Date.UTC(prevYear, prevMonth - 1, 1, 0, 0, 0) + BRT_OFFSET_MS,
  );
}

/** `checkIns` must cover at least from `resolvePreviousMonthStart(now)` onward. */
export function computeMonthOverMonth(
  checkIns: { createdAt: Date }[],
  now: Date,
): MonthOverMonth {
  const [year, month] = brtDateKey(now).split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  let currentMonthCount = 0;
  let previousMonthCount = 0;
  let hasPreviousMonthData = false;

  for (const checkIn of checkIns) {
    const [y, m] = brtDateKey(checkIn.createdAt).split('-').map(Number);
    if (y === year && m === month) {
      currentMonthCount += 1;
    } else if (y === prevYear && m === prevMonth) {
      previousMonthCount += 1;
      hasPreviousMonthData = true;
    }
  }

  const todayOfMonth = Number(brtDateKey(now).split('-')[2]);
  const lastDayOfCurrentMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    currentMonthCount,
    previousMonthCount: hasPreviousMonthData ? previousMonthCount : null,
    isCurrentMonthPartial: todayOfMonth < lastDayOfCurrentMonth,
  };
}
