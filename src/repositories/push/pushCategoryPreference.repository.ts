import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { NotificationCategory, PushCategoryPreference } from '@prisma/client';

@Injectable()
export class PushCategoryPreferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByUser(userId: string): Promise<PushCategoryPreference[]> {
    return await this.prisma.pushCategoryPreference.findMany({
      where: { userId },
    });
  }

  async findOne(
    userId: string,
    category: NotificationCategory,
  ): Promise<PushCategoryPreference | null> {
    return await this.prisma.pushCategoryPreference.findUnique({
      where: { userId_category: { userId, category } },
    });
  }

  async upsert(
    userId: string,
    category: NotificationCategory,
    enabled: boolean,
  ): Promise<PushCategoryPreference> {
    return await this.prisma.pushCategoryPreference.upsert({
      where: { userId_category: { userId, category } },
      create: { userId, category, enabled },
      update: { enabled },
    });
  }
}
