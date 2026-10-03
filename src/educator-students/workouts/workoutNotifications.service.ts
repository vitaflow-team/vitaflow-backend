import { NotificationsService } from '@/notifications/notifications.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory } from '@prisma/client';
import { EDIT_NOTIFICATION_WINDOW_MINUTES } from './workoutLimits.constants';

export const WORKOUT_PLAN_LINK = '/restrict/workouts?plano=educador';

export function activationMessage(educatorName: string): string {
  return `${educatorName} ativou um novo treino para você.`;
}

export function editMessage(educatorName: string): string {
  return `${educatorName} atualizou o seu treino.`;
}

/**
 * Tells the linked student about their educator's workout (ADR-005). It runs
 * after the educator's transaction committed and never throws: a failure here
 * is logged and the save or activation has already succeeded. Messages carry
 * the educator's name only, never exercise, load or video content.
 */
@Injectable()
export class WorkoutNotificationsService {
  private readonly logger = new Logger(WorkoutNotificationsService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly clients: ClientsRepository,
    private readonly users: UserRepository,
    private readonly workouts: EducatorWorkoutsRepository,
  ) {}

  // Activation always notifies (the window starts at activation).
  async notifyActivated(
    educatorId: string,
    clientId: string,
    workoutId: string,
  ): Promise<void> {
    await this.send({ educatorId, clientId, workoutId, edit: false });
  }

  // An edit of the active workout notifies only when it wins the 30-minute
  // window claim; edits inside the window are grouped into the last notice.
  async notifyEdited(
    educatorId: string,
    clientId: string,
    workoutId: string,
  ): Promise<void> {
    await this.send({ educatorId, clientId, workoutId, edit: true });
  }

  private async send(input: {
    educatorId: string;
    clientId: string;
    workoutId: string;
    edit: boolean;
  }): Promise<void> {
    const { educatorId, clientId, workoutId, edit } = input;
    try {
      const student = await this.clients.findOwnedById(clientId, educatorId);
      if (!student?.userId) return;

      if (edit) {
        const claimed = await this.workouts.claimEditNotification(
          workoutId,
          new Date(),
          EDIT_NOTIFICATION_WINDOW_MINUTES,
        );
        if (!claimed) {
          this.logger.log(
            `workout_notification_skipped_window workoutId=${workoutId}`,
          );
          return;
        }
      }

      const educator = await this.users.findUnique({ id: educatorId });
      const name = educator?.name ?? 'Seu educador físico';
      await this.notifications.create(
        student.userId,
        NotificationCategory.WORKOUT_PLAN,
        edit ? editMessage(name) : activationMessage(name),
        WORKOUT_PLAN_LINK,
      );
      this.logger.log(`workout_notification_sent workoutId=${workoutId}`);
    } catch {
      this.logger.error(`workout_notification_failed workoutId=${workoutId}`);
    }
  }
}
