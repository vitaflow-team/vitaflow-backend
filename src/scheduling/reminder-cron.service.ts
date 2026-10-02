import { NotificationsService } from '@/notifications/notifications.service';
import { SchedulingRepository } from '@/repositories/scheduling/scheduling.repository';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Clock } from './clock.service';
import {
  MINUTE_MS,
  REMINDER_WINDOW_END_MINUTES,
  REMINDER_WINDOW_START_MINUTES,
} from './scheduling.constants';
import { appUrl, formatDateTime } from './schedulingFormat.util';

// ADR-003: polling, not a delayed job — a few minutes of jitter around "1
// hour before" is accepted in exchange for no new Redis dependency.
@Injectable()
export class ReminderCronService {
  private readonly logger = new Logger(ReminderCronService.name);

  constructor(
    private readonly scheduling: SchedulingRepository,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  @Cron('*/5 * * * *')
  async sendDueReminders(): Promise<void> {
    const now = this.clock.now();
    const windowStart = new Date(
      now.getTime() + REMINDER_WINDOW_START_MINUTES * MINUTE_MS,
    );
    const windowEnd = new Date(
      now.getTime() + REMINDER_WINDOW_END_MINUTES * MINUTE_MS,
    );

    const due = await this.scheduling.findDueForReminder(
      windowStart,
      windowEnd,
    );

    let sent = 0;
    let skipped = 0;

    for (const slot of due) {
      // Claimed first, atomically: a session already reminded by an
      // overlapping run (or, per the TechSpec's Known Risk, a second
      // backend instance) is skipped rather than double-notified.
      const claimed = await this.scheduling.claimReminder(slot.id, now);
      if (claimed === 0) {
        skipped += 1;
        continue;
      }

      const when = formatDateTime(slot.startAt);
      const link = appUrl('/restrict/scheduling');
      if (slot.user) {
        await this.notifications.create(
          slot.user.id,
          'CONSULTATION_REMINDER',
          `Sua sessão com ${slot.professional.name} começa às ${when}.`,
          link,
        );
      }
      await this.notifications.create(
        slot.professional.id,
        'CONSULTATION_REMINDER',
        `Sua sessão com ${slot.user?.name ?? 'o aluno'} começa às ${when}.`,
        link,
      );
      sent += 1;
    }

    this.logger.log(
      `reminder_cron_run due=${due.length} sent=${sent} skipped=${skipped}`,
    );
  }
}
