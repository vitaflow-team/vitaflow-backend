import { PrismaService } from '@/database/prisma.service';
import {
  educatorScheduleLockKey,
  OccupancyRow,
  TimeRange,
} from '@/scheduling/fixed-times/fixedTime.util';
import { Injectable } from '@nestjs/common';
import {
  FixedSession,
  FixedTime,
  Prisma,
  SessionType,
  Slot,
} from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface FixedTimeData {
  clientId: string;
  professionalId: string;
  weekday: number;
  startMinute: number;
  durationMinutes: number;
  type: SessionType;
  onlineLink: string | null;
  workoutLetter: string | null;
}

export type SessionData = TimeRange & {
  fixedTimeId: string;
  clientId: string;
  professionalId: string;
  type: SessionType;
  onlineLink: string | null;
  workoutLetter: string | null;
};

export type FixedTimeRuleFields = Partial<
  Pick<
    FixedTimeData,
    | 'weekday'
    | 'startMinute'
    | 'durationMinutes'
    | 'type'
    | 'onlineLink'
    | 'workoutLetter'
  >
>;

const SLOT_BOOKED_USER = 'Aluno';

/**
 * Persistence for fixed times and their sessions. Every write that depends on
 * the educator's other time runs inside `withEducatorLock`, which is the same
 * advisory lock the booking path takes (ADR-005).
 */
@Injectable()
export class FixedTimesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `work` in one transaction that holds the educator's advisory lock
   * until it commits or rolls back. Two creations or edits for the same
   * educator therefore never read the same occupancy at once.
   */
  async withEducatorLock<T>(
    educatorId: string,
    work: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${educatorScheduleLockKey(educatorId)}))`;
      return await work(tx);
    });
  }

  async findRulesByClient(clientId: string): Promise<FixedTime[]> {
    return await this.prisma.fixedTime.findMany({
      where: { clientId },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });
  }

  async findRuleOfClient(
    clientId: string,
    fixedTimeId: string,
    tx: Tx = this.prisma,
  ): Promise<FixedTime | null> {
    return await tx.fixedTime.findFirst({
      where: { id: fixedTimeId, clientId },
    });
  }

  async countRulesByClient(
    clientId: string,
    tx: Tx = this.prisma,
  ): Promise<number> {
    return await tx.fixedTime.count({ where: { clientId } });
  }

  async createRule(
    data: FixedTimeData,
    tx: Tx = this.prisma,
  ): Promise<FixedTime> {
    return await tx.fixedTime.create({ data });
  }

  async updateRule(
    id: string,
    data: FixedTimeRuleFields,
    tx: Tx = this.prisma,
  ): Promise<FixedTime> {
    return await tx.fixedTime.update({ where: { id }, data });
  }

  async deleteRule(id: string, tx: Tx = this.prisma): Promise<void> {
    await tx.fixedTime.delete({ where: { id } });
  }

  /** Scheduled and canceled rows of one rule that have not started yet. */
  async findFutureSessions(
    fixedTimeId: string,
    now: Date,
    tx: Tx = this.prisma,
  ): Promise<FixedSession[]> {
    return await tx.fixedSession.findMany({
      where: { fixedTimeId, startAt: { gt: now } },
      orderBy: { startAt: 'asc' },
    });
  }

  async deleteSessions(ids: string[], tx: Tx = this.prisma): Promise<void> {
    if (ids.length === 0) return;
    await tx.fixedSession.deleteMany({ where: { id: { in: ids } } });
  }

  async createSessions(
    rows: SessionData[],
    tx: Tx = this.prisma,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const result = await tx.fixedSession.createMany({ data: rows });
    return result.count;
  }

  /** Sessions that already started keep their rows; only the reference is cleared. */
  async detachStartedSessions(
    fixedTimeId: string,
    now: Date,
    tx: Tx = this.prisma,
  ): Promise<void> {
    await tx.fixedSession.updateMany({
      where: { fixedTimeId, startAt: { lte: now } },
      data: { fixedTimeId: null },
    });
  }

  /** Future scheduled sessions of a rule, updated in place. */
  async updateFutureScheduled(
    fixedTimeId: string,
    now: Date,
    data: Partial<Pick<FixedSession, 'type' | 'onlineLink' | 'workoutLetter'>>,
    where: Prisma.FixedSessionWhereInput = {},
    tx: Tx = this.prisma,
  ): Promise<void> {
    await tx.fixedSession.updateMany({
      where: {
        ...where,
        fixedTimeId,
        startAt: { gt: now },
        status: 'SCHEDULED',
      },
      data,
    });
  }

  /**
   * Every row that occupies the educator's time in the window: fixed sessions
   * (scheduled or canceled, the caller decides) and booked slots.
   */
  async findOccupancy(
    educatorId: string,
    window: TimeRange,
    tx: Tx = this.prisma,
  ): Promise<OccupancyRow[]> {
    const [sessions, booked] = await Promise.all([
      tx.fixedSession.findMany({
        where: {
          professionalId: educatorId,
          startAt: { lt: window.endAt },
          endAt: { gt: window.startAt },
        },
        include: { client: { select: { name: true } } },
      }),
      tx.slot.findMany({
        where: {
          professionalId: educatorId,
          status: 'BOOKED',
          startAt: { lt: window.endAt },
          endAt: { gt: window.startAt },
        },
        include: { user: { select: { name: true } } },
      }),
    ]);

    return [
      ...sessions.map((row) => ({
        startAt: row.startAt,
        endAt: row.endAt,
        status: row.status,
        fixedTimeId: row.fixedTimeId,
        studentName: row.client.name,
      })),
      ...booked.map((row) => ({
        startAt: row.startAt,
        endAt: row.endAt,
        status: 'BOOKED' as const,
        fixedTimeId: null,
        studentName: row.user?.name ?? SLOT_BOOKED_USER,
      })),
    ];
  }

  /** Whether a scheduled fixed session of the educator overlaps the range. */
  async hasScheduledOverlap(
    educatorId: string,
    range: TimeRange,
    tx: Tx = this.prisma,
  ): Promise<boolean> {
    const count = await tx.fixedSession.count({
      where: {
        professionalId: educatorId,
        status: 'SCHEDULED',
        startAt: { lt: range.endAt },
        endAt: { gt: range.startAt },
      },
    });
    return count > 0;
  }

  /** The student's fixed sessions in a window, canceled ones included. */
  async findClientSessions(
    clientId: string,
    window: TimeRange,
  ): Promise<FixedSession[]> {
    return await this.prisma.fixedSession.findMany({
      where: {
        clientId,
        startAt: { lt: window.endAt },
        endAt: { gt: window.startAt },
      },
      orderBy: { startAt: 'asc' },
    });
  }

  /** The student's booked sessions with this educator in the window. */
  async findBookedForUser(
    educatorId: string,
    userId: string,
    window: TimeRange,
  ): Promise<Slot[]> {
    return await this.prisma.slot.findMany({
      where: {
        professionalId: educatorId,
        userId,
        status: 'BOOKED',
        startAt: { lt: window.endAt },
        endAt: { gt: window.startAt },
      },
      orderBy: { startAt: 'asc' },
    });
  }

  /** One fixed session with the counterparts needed for notices and labels. */
  async findSessionWithParties(id: string, tx: Tx = this.prisma) {
    return await tx.fixedSession.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true, userId: true } },
        professional: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Cancels one scheduled session. The conditional update is the single
   * place that decides a simultaneous pair of cancellations: only the call
   * that changes the row returns 1.
   */
  async cancelSession(id: string, actorId: string, now: Date): Promise<number> {
    const result = await this.prisma.fixedSession.updateMany({
      where: { id, status: 'SCHEDULED', startAt: { gt: now } },
      data: { status: 'CANCELED', canceledBy: actorId },
    });
    return result.count;
  }

  async setSessionLink(id: string, link: string): Promise<void> {
    await this.prisma.fixedSession.update({
      where: { id },
      data: { onlineLink: link },
    });
  }

  /** The educator's or the linked student's scheduled fixed sessions from now on. */
  async findUpcomingFixedForActor(actorId: string, now: Date) {
    return await this.prisma.fixedSession.findMany({
      where: {
        status: 'SCHEDULED',
        startAt: { gte: now },
        OR: [{ professionalId: actorId }, { client: { userId: actorId } }],
      },
      include: {
        client: { select: { id: true, name: true, userId: true } },
        professional: { select: { id: true, name: true } },
      },
      orderBy: { startAt: 'asc' },
    });
  }

  async findScheduledFromForClients(
    educatorId: string,
    clientIds: string[],
    now: Date,
  ): Promise<FixedSession[]> {
    if (clientIds.length === 0) return [];
    return await this.prisma.fixedSession.findMany({
      where: {
        professionalId: educatorId,
        clientId: { in: clientIds },
        status: 'SCHEDULED',
        startAt: { gte: now },
      },
      orderBy: { startAt: 'asc' },
    });
  }

  async findBookedFromForUsers(
    educatorId: string,
    userIds: string[],
    now: Date,
  ): Promise<Slot[]> {
    if (userIds.length === 0) return [];
    return await this.prisma.slot.findMany({
      where: {
        professionalId: educatorId,
        userId: { in: userIds },
        status: 'BOOKED',
        startAt: { gte: now },
      },
      orderBy: { startAt: 'asc' },
    });
  }

  /** Scheduled sessions of one student record in a window, for today's session. */
  async findScheduledForClientBetween(
    clientId: string,
    window: TimeRange,
  ): Promise<FixedSession[]> {
    return await this.prisma.fixedSession.findMany({
      where: {
        clientId,
        status: 'SCHEDULED',
        startAt: { lt: window.endAt },
        endAt: { gt: window.startAt },
      },
      orderBy: { startAt: 'asc' },
    });
  }

  /** Scheduled fixed sessions starting in the reminder window, not reminded yet. */
  async findDueFixedReminders(windowStart: Date, windowEnd: Date) {
    return await this.prisma.fixedSession.findMany({
      where: {
        status: 'SCHEDULED',
        startAt: { gte: windowStart, lte: windowEnd },
        reminderSentAt: null,
      },
      include: {
        client: { select: { id: true, name: true, userId: true } },
        professional: { select: { id: true, name: true } },
      },
    });
  }

  async claimFixedReminder(id: string, sentAt: Date): Promise<number> {
    const result = await this.prisma.fixedSession.updateMany({
      where: { id, reminderSentAt: null },
      data: { reminderSentAt: sentAt },
    });
    return result.count;
  }

  async findAllRules(): Promise<FixedTime[]> {
    return await this.prisma.fixedTime.findMany({
      orderBy: [{ professionalId: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Every session row of a rule in the window, whatever its status. */
  async findRuleSessionsBetween(
    fixedTimeId: string,
    window: TimeRange,
    tx: Tx = this.prisma,
  ): Promise<FixedSession[]> {
    return await tx.fixedSession.findMany({
      where: {
        fixedTimeId,
        startAt: { gte: window.startAt, lte: window.endAt },
      },
    });
  }

  /** The renewal inserts rows that may already exist: duplicates are skipped. */
  async createSessionsSkippingDuplicates(
    rows: SessionData[],
    tx: Tx = this.prisma,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const result = await tx.fixedSession.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return result.count;
  }
}
