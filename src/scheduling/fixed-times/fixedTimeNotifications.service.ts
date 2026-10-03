import { NotificationsService } from '@/notifications/notifications.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, SessionType } from '@prisma/client';
import { SCHEDULE_CHANGE_LINK } from './fixedTime.constants';
import { FixedTimeRule } from './fixedTime.util';

export type ScheduleChangeKind = 'created' | 'changed' | 'removed';

const WEEKDAY_NAMES = [
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
  'domingo',
];

const VERBS: Record<ScheduleChangeKind, string> = {
  created: 'marcou um horário fixo',
  changed: 'alterou o seu horário fixo',
  removed: 'removeu o seu horário fixo',
};

function clock(startMinute: number): string {
  const hours = Math.floor(startMinute / 60);
  const minutes = startMinute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * The notice text: the educator's name, the weekday, the time and the type.
 * Nothing else about the student or the workout is included (ADR-003).
 */
export function scheduleChangeMessage(
  kind: ScheduleChangeKind,
  educatorName: string,
  rule: Pick<FixedTimeRule, 'weekday' | 'startMinute' | 'type'>,
): string {
  const day = WEEKDAY_NAMES[rule.weekday - 1];
  const type = rule.type === SessionType.ONLINE ? 'online' : 'presencial';
  return `${educatorName} ${VERBS[kind]}: ${day} às ${clock(rule.startMinute)}, ${type}.`;
}

/**
 * Tells the linked student about a change to their fixed time. It runs after
 * the educator's transaction committed and never throws: a failure is logged
 * and the action has already succeeded. A record without an account has no
 * one to tell.
 */
@Injectable()
export class FixedTimeNotificationsService {
  private readonly logger = new Logger(FixedTimeNotificationsService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly users: UserRepository,
  ) {}

  async notify(input: {
    educatorId: string;
    userId: string | null;
    kind: ScheduleChangeKind;
    rule: Pick<FixedTimeRule, 'weekday' | 'startMinute' | 'type'>;
  }): Promise<void> {
    const { educatorId, userId, kind, rule } = input;
    if (!userId) return;

    try {
      const educator = await this.users.findUnique({ id: educatorId });
      const name = educator?.name ?? 'Seu educador físico';
      await this.notifications.create(
        userId,
        NotificationCategory.SCHEDULE_CHANGE,
        scheduleChangeMessage(kind, name, rule),
        SCHEDULE_CHANGE_LINK,
      );
      this.logger.log(
        `schedule_change_notified kind=${kind} educatorId=${educatorId}`,
      );
    } catch {
      this.logger.error(
        `schedule_change_notification_failed kind=${kind} educatorId=${educatorId}`,
      );
    }
  }
}
