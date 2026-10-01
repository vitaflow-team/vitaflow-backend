import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import {
  Notification,
  NotificationCategory,
  NotificationPreference,
} from '@prisma/client';

export interface NotificationInput {
  category: NotificationCategory;
  message: string;
  link?: string;
}

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, data: NotificationInput): Promise<Notification> {
    return await this.prisma.notification.create({
      data: { ...data, userId },
    });
  }

  async findById(id: string): Promise<Notification | null> {
    return await this.prisma.notification.findUnique({ where: { id } });
  }

  async findByUser(
    userId: string,
    skip: number,
    take: number,
  ): Promise<Notification[]> {
    return await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async markRead(id: string): Promise<Notification> {
    return await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async countUnread(userId: string): Promise<number> {
    return await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  async findPreference(
    userId: string,
    category: NotificationCategory,
  ): Promise<NotificationPreference | null> {
    return await this.prisma.notificationPreference.findUnique({
      where: { userId_category: { userId, category } },
    });
  }

  async findAllPreferences(userId: string): Promise<NotificationPreference[]> {
    return await this.prisma.notificationPreference.findMany({
      where: { userId },
    });
  }

  // Upsert so repeatedly setting the same category never races with a
  // conflicting insert: there is never more than one row per (user,
  // category) by design (ADR-003's unique constraint).
  async upsertPreference(
    userId: string,
    category: NotificationCategory,
    enabled: boolean,
  ): Promise<NotificationPreference> {
    return await this.prisma.notificationPreference.upsert({
      where: { userId_category: { userId, category } },
      create: { userId, category, enabled },
      update: { enabled },
    });
  }
}
