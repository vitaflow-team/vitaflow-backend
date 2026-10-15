import { NotificationsService } from '@/notifications/notifications.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory } from '@prisma/client';

@Injectable()
export class AcademiaActivityService {
  private readonly logger = new Logger(AcademiaActivityService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly notifications: NotificationsService,
  ) {}

  async recordActivity(academiaId: string, message: string): Promise<void> {
    try {
      const owner = await this.users.findUnique({ academiaId });
      if (!owner) {
        this.logger.warn(`academia_activity_no_owner academiaId=${academiaId}`);
        return;
      }
      await this.notifications.create(
        owner.id,
        NotificationCategory.ACADEMIA_ACTIVITY,
        message,
      );
    } catch {
      this.logger.error(
        `academia_activity_fanout_failed academiaId=${academiaId}`,
      );
    }
  }
}
