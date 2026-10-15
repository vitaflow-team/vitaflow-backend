import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { Injectable } from '@nestjs/common';
import { NotificationCategory } from '@prisma/client';

export const PAINEL_ACTIVITY_LIMIT = 20;

export interface PainelEducator {
  id: string;
  name: string;
  email: string;
  startedAt: Date;
}

export interface PainelActivityItem {
  id: string;
  message: string;
  createdAt: Date;
}

export interface PainelResponse {
  educatorCount: number;
  studentCount: number;
  educators: PainelEducator[];
  activity: PainelActivityItem[];
}

@Injectable()
export class PainelService {
  constructor(
    private readonly clients: ClientsRepository,
    private readonly employments: EmploymentRepository,
    private readonly notifications: NotificationsRepository,
  ) {}

  async getPainel(
    academiaId: string,
    ownerId: string,
  ): Promise<PainelResponse> {
    const [employments, studentCount, notifications] = await Promise.all([
      this.employments.listActiveByAcademia(academiaId),
      this.clients.countByAcademiaId(academiaId),
      this.notifications.findRecentByUserAndCategory(
        ownerId,
        NotificationCategory.ACADEMIA_ACTIVITY,
        PAINEL_ACTIVITY_LIMIT,
      ),
    ]);

    return {
      educatorCount: employments.length,
      studentCount,
      educators: employments.map((employment) => ({
        id: employment.educator.id,
        name: employment.educator.name,
        email: employment.educator.email,
        startedAt: employment.startedAt,
      })),
      activity: notifications.map((notification) => ({
        id: notification.id,
        message: notification.message,
        createdAt: notification.createdAt,
      })),
    };
  }
}
