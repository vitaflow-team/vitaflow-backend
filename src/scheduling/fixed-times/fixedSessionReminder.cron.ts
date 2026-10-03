import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { NotificationsService } from '@/notifications/notifications.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Clock } from '../clock.service';
import {
  MINUTE_MS,
  REMINDER_WINDOW_END_MINUTES,
  REMINDER_WINDOW_START_MINUTES,
} from '../scheduling.constants';
import { appUrl, formatDateTime } from '../schedulingFormat.util';
import { resolveLetter } from './fixedTime.util';

const NOTICE_LINK = '/restrict/scheduling';

/**
 * One reminder per side, an hour before a scheduled fixed session. The claim
 * is atomic, so a second run or a second instance sends nothing again. The
 * message names the linked session when its letter resolves; a record without
 * an account has only the educator to remind.
 */
@Injectable()
export class FixedSessionReminderCron {
  private readonly logger = new Logger(FixedSessionReminderCron.name);

  constructor(
    private readonly repo: FixedTimesRepository,
    private readonly workouts: EducatorWorkoutsRepository,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  @Cron('*/5 * * * *')
  async sendDueFixedReminders(): Promise<void> {
    const now = this.clock.now();
    const due = await this.repo.findDueFixedReminders(
      new Date(now.getTime() + REMINDER_WINDOW_START_MINUTES * MINUTE_MS),
      new Date(now.getTime() + REMINDER_WINDOW_END_MINUTES * MINUTE_MS),
    );

    let sent = 0;
    let skipped = 0;
    for (const row of due) {
      const claimed = await this.repo.claimFixedReminder(row.id, now);
      if (claimed === 0) {
        skipped += 1;
        continue;
      }

      const names = await this.activeSessionNames(row.clientId);
      const letter = resolveLetter(row.workoutLetter, names);
      const when = formatDateTime(row.startAt);
      const educator = row.professional.name;
      const student = row.client.name;
      const linked = letter.sessionName !== null;

      if (row.client.userId) {
        const copy = linked
          ? `Sua sessão ${row.workoutLetter} (${letter.sessionName}) com ${educator} começa às ${when}.`
          : `Sua sessão com ${educator} começa às ${when}.`;
        await this.notify(row.client.userId, copy, row.id);
      }
      await this.notify(
        row.professional.id,
        linked
          ? `Sua sessão ${row.workoutLetter} (${letter.sessionName}) com ${student} começa às ${when}.`
          : `Sua sessão com ${student} começa às ${when}.`,
        row.id,
      );
      sent += 1;
    }

    this.logger.log(
      `fixed_reminder_cron_run due=${due.length} sent=${sent} skipped=${skipped}`,
    );
  }

  private async notify(
    userId: string,
    message: string,
    fixedSessionId: string,
  ): Promise<void> {
    try {
      await this.notifications.create(
        userId,
        'CONSULTATION_REMINDER',
        message,
        appUrl(NOTICE_LINK),
      );
    } catch {
      this.logger.error(
        `fixed_reminder_notice_failed fixedSessionId=${fixedSessionId}`,
      );
    }
  }

  private async activeSessionNames(clientId: string): Promise<string[] | null> {
    const active = await this.workouts.findActiveByClient(clientId);
    return active ? active.sessions.map((session) => session.name) : null;
  }
}
