import { CodedError } from '@/common/errors/codedError';
import { NotificationsService } from '@/notifications/notifications.service';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { Injectable, Logger } from '@nestjs/common';
import { SessionType } from '@prisma/client';
import { Clock } from '../clock.service';
import { appUrl, formatDateTime } from '../schedulingFormat.util';
import { FIXED_SESSION_NOT_FOUND } from './fixedTime.constants';
import {
  isHttpLink,
  resolveLetter,
  TimeRange,
  todaySession,
} from './fixedTime.util';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// A cancellation this close to the start is the late copy (same rule as bookings).
const LATE_CANCELLATION_HOURS = 4;
const NOTICE_LINK = '/restrict/scheduling';
const NOT_CANCELABLE = 'session_not_cancelable';

export interface FixedSessionCounterpart {
  id: string;
  name: string;
}

/** A fixed session as the merged upcoming list shows it. */
export interface UpcomingFixedItem extends TimeRange {
  id: string;
  source: 'FIXED';
  type: SessionType;
  onlineLink: string | null;
  status: 'SCHEDULED';
  workoutLetter: string | null;
  workoutSessionName: string | null;
  counterpart: FixedSessionCounterpart;
}

/** The next time of one student record with the educator: fixed or booked. */
export interface NextSession {
  startAt: Date;
  endAt: Date;
  type: SessionType;
  onlineLink: string | null;
  workoutLetter: string | null;
}

/** The copy of the cancellation notice, late or on time. */
export function cancelCopy(startAt: Date, now: Date): string {
  const late =
    startAt.getTime() - now.getTime() < LATE_CANCELLATION_HOURS * HOUR_MS;
  return late
    ? `Sua sessão de ${formatDateTime(startAt)} foi cancelada em cima da hora.`
    : `Sua sessão de ${formatDateTime(startAt)} foi cancelada.`;
}

/**
 * One fixed session at a time: cancel one date (either side), set its link
 * (the educator), and the reads that merge fixed sessions with bookings
 * (ADR-003, ADR-004, ADR-005). Anyone who is not a party gets the same 404.
 */
@Injectable()
export class FixedSessionsService {
  private readonly logger = new Logger(FixedSessionsService.name);

  constructor(
    private readonly repo: FixedTimesRepository,
    private readonly workouts: EducatorWorkoutsRepository,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  async cancel(actorId: string, fixedSessionId: string): Promise<void> {
    const row = await this.repo.findSessionWithParties(fixedSessionId);
    const isEducator = row?.professionalId === actorId;
    const isStudent = row?.client.userId === actorId;
    if (!row || (!isEducator && !isStudent)) {
      throw new CodedError(FIXED_SESSION_NOT_FOUND, 404, 'session_not_found');
    }

    const now = this.clock.now();
    if (row.startAt <= now) {
      throw new CodedError(
        'Não é possível cancelar uma sessão que já aconteceu ou está acontecendo.',
        400,
        NOT_CANCELABLE,
      );
    }
    if (row.status === 'CANCELED') {
      throw new CodedError(
        'Esta sessão já foi cancelada.',
        409,
        NOT_CANCELABLE,
      );
    }

    // The conditional update decides a simultaneous pair: only one call sees
    // the row still scheduled, the other answers as already canceled.
    const claimed = await this.repo.cancelSession(fixedSessionId, actorId, now);
    if (claimed === 0) {
      throw new CodedError(
        'Esta sessão já foi cancelada.',
        409,
        NOT_CANCELABLE,
      );
    }
    this.logger.log(
      `fixed_session_canceled fixedSessionId=${fixedSessionId} by=${isEducator ? 'educator' : 'student'}`,
    );

    const recipientId = isEducator ? row.client.userId : row.professionalId;
    if (!recipientId) return;
    try {
      await this.notifications.create(
        recipientId,
        'CONSULTATION_REMINDER',
        cancelCopy(row.startAt, now),
        appUrl(NOTICE_LINK),
      );
    } catch {
      this.logger.error(
        `fixed_session_cancel_notice_failed fixedSessionId=${fixedSessionId}`,
      );
    }
  }

  // ADR-001: the educator sets the link of one session. A presencial session
  // has no link; a link must be http or https.
  async setLink(
    educatorId: string,
    fixedSessionId: string,
    link: string,
  ): Promise<void> {
    const row = await this.repo.findSessionWithParties(fixedSessionId);
    if (!row || row.professionalId !== educatorId) {
      throw new CodedError(FIXED_SESSION_NOT_FOUND, 404, 'session_not_found');
    }
    if (row.type === SessionType.PRESENCIAL) {
      throw new CodedError(
        'Um horário presencial não aceita link.',
        400,
        'link_not_allowed',
      );
    }
    if (!isHttpLink(link)) {
      throw new CodedError(
        'Use um link http ou https, sem espaços.',
        400,
        'fixed_time_invalid',
      );
    }
    await this.repo.setSessionLink(fixedSessionId, link);
  }

  // The scheduled fixed sessions the actor takes part in, from now on, with the
  // counterpart and the letter resolved against the student's active workout.
  async listUpcomingForActor(
    actorId: string,
    now: Date,
  ): Promise<UpcomingFixedItem[]> {
    const rows = await this.repo.findUpcomingFixedForActor(actorId, now);
    const names = new Map<string, string[] | null>();
    const items: UpcomingFixedItem[] = [];

    for (const row of rows) {
      if (!names.has(row.clientId)) {
        names.set(row.clientId, await this.activeSessionNames(row.clientId));
      }
      const letter = resolveLetter(
        row.workoutLetter,
        names.get(row.clientId) ?? null,
      );
      const isEducator = row.professionalId === actorId;
      items.push({
        id: row.id,
        source: 'FIXED',
        startAt: row.startAt,
        endAt: row.endAt,
        type: row.type,
        onlineLink: row.onlineLink,
        status: 'SCHEDULED',
        workoutLetter: row.workoutLetter,
        workoutSessionName: letter.sessionName,
        counterpart: isEducator
          ? { id: row.client.id, name: row.client.name }
          : { id: row.professional.id, name: row.professional.name },
      });
    }
    return items;
  }

  // For each student record: the earliest scheduled fixed session or booked
  // slot that starts now or later. Canceled sessions never count.
  async nextForRecords(
    educatorId: string,
    records: Array<{ clientId: string; userId: string | null }>,
    now: Date,
  ): Promise<Map<string, NextSession>> {
    const clientOfUser = new Map<string, string>();
    for (const record of records) {
      if (record.userId) clientOfUser.set(record.userId, record.clientId);
    }
    const [fixed, booked] = await Promise.all([
      this.repo.findScheduledFromForClients(
        educatorId,
        records.map((record) => record.clientId),
        now,
      ),
      this.repo.findBookedFromForUsers(
        educatorId,
        [...clientOfUser.keys()],
        now,
      ),
    ]);

    const next = new Map<string, NextSession>();
    const offer = (clientId: string, session: NextSession) => {
      const current = next.get(clientId);
      if (!current || session.startAt < current.startAt)
        next.set(clientId, session);
    };
    for (const row of fixed) {
      offer(row.clientId, {
        startAt: row.startAt,
        endAt: row.endAt,
        type: row.type,
        onlineLink: row.onlineLink,
        workoutLetter: row.workoutLetter,
      });
    }
    for (const row of booked) {
      const clientId = row.userId ? clientOfUser.get(row.userId) : undefined;
      if (clientId) {
        offer(clientId, {
          startAt: row.startAt,
          endAt: row.endAt,
          type: row.type ?? SessionType.PRESENCIAL,
          onlineLink: row.onlineLink,
          workoutLetter: null,
        });
      }
    }
    return next;
  }

  // Today's scheduled session of a record (Brasília date): the earliest that
  // has not ended and whose letter names a session of the active workout
  // (ADR-004). Returns its id, or null.
  async todaySessionId(clientId: string, now: Date): Promise<string | null> {
    const names = await this.activeSessionNames(clientId);
    if (names === null) return null;
    const rows = await this.repo.findScheduledForClientBetween(clientId, {
      startAt: new Date(now.getTime() - DAY_MS),
      endAt: new Date(now.getTime() + DAY_MS),
    });
    const found = todaySession(
      rows,
      now,
      (letter) =>
        !resolveLetter(letter, names).missing &&
        resolveLetter(letter, names).sessionName !== null,
    );
    return found?.id ?? null;
  }

  private async activeSessionNames(clientId: string): Promise<string[] | null> {
    const active = await this.workouts.findActiveByClient(clientId);
    return active ? active.sessions.map((session) => session.name) : null;
  }
}
