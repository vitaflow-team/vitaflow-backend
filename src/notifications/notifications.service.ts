import { MailService } from '@/mail/mail.service';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { Injectable, Logger } from '@nestjs/common';
import { Notification, NotificationCategory } from '@prisma/client';
import { NotificationEntity } from './notification.entity';

export const NOTIFICATIONS_PAGE_SIZE = 50;

const NOT_FOUND = 'Notificação não encontrada.';
const EMAIL_SUBJECT = 'Nova notificação Vita Flow';

// Every category defaults on except PRODUCT_NEWS (PRD Business Rules,
// ADR-003): a missing NotificationPreference row is never backfilled —
// this is the documented default it falls back to.
const DEFAULT_PREFERENCES: Record<NotificationCategory, boolean> = {
  WORKOUT_REMINDER: true,
  CONSULTATION_REMINDER: true,
  MESSAGES: true,
  BILLING: true,
  PRODUCT_NEWS: false,
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly notifications: NotificationsRepository,
    private readonly users: UserRepository,
    private readonly mailService: MailService,
  ) {}

  // The Notification row is always written, regardless of the category's
  // preference (PRD Business Rules) — only the email send is gated. An
  // email failure is caught here, never propagated, so it can never roll
  // back or appear to fail the already-committed in-app record.
  async create(
    userId: string,
    category: NotificationCategory,
    message: string,
    link?: string,
  ): Promise<NotificationEntity> {
    const notification = await this.notifications.create(userId, {
      category,
      message,
      link,
    });

    const enabled = await this.isEnabled(userId, category);
    let emailAttempted = false;
    if (enabled) {
      emailAttempted = true;
      await this.sendEmail(userId, category, message, link);
    }

    this.logger.log(
      `notification_created userId=${userId} category=${category} emailAttempted=${emailAttempted}`,
    );
    return this.toEntity(notification);
  }

  private async sendEmail(
    userId: string,
    category: NotificationCategory,
    message: string,
    link?: string,
  ): Promise<void> {
    try {
      const user = await this.users.findUnique({ id: userId });
      if (!user) return;
      await this.mailService.sendNotificationEmail(
        user.name,
        user.email,
        EMAIL_SUBJECT,
        message,
        link,
      );
    } catch {
      this.logger.error(
        `notification_email_failed userId=${userId} category=${category}`,
      );
    }
  }

  async listForUser(userId: string, page = 1): Promise<NotificationEntity[]> {
    const rows = await this.notifications.findByUser(
      userId,
      (page - 1) * NOTIFICATIONS_PAGE_SIZE,
      NOTIFICATIONS_PAGE_SIZE,
    );
    return rows.map((row) => this.toEntity(row));
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const notification = await this.notifications.findById(notificationId);
    if (!notification || notification.userId !== userId) {
      throw new AppError(NOT_FOUND, 404);
    }
    if (!notification.readAt) {
      await this.notifications.markRead(notificationId);
    }
  }

  async getUnreadCount(userId: string): Promise<number> {
    return await this.notifications.countUnread(userId);
  }

  async getPreferences(
    userId: string,
  ): Promise<Record<NotificationCategory, boolean>> {
    const rows = await this.notifications.findAllPreferences(userId);
    const preferences = { ...DEFAULT_PREFERENCES };
    for (const row of rows) {
      preferences[row.category] = row.enabled;
    }
    return preferences;
  }

  async setPreference(
    userId: string,
    category: NotificationCategory,
    enabled: boolean,
  ): Promise<void> {
    await this.notifications.upsertPreference(userId, category, enabled);
  }

  private async isEnabled(
    userId: string,
    category: NotificationCategory,
  ): Promise<boolean> {
    const preference = await this.notifications.findPreference(
      userId,
      category,
    );
    return preference ? preference.enabled : DEFAULT_PREFERENCES[category];
  }

  private toEntity(notification: Notification): NotificationEntity {
    return {
      id: notification.id,
      category: notification.category,
      message: notification.message,
      link: notification.link,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    };
  }
}
