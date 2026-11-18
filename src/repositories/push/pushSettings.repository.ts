import { PrismaService } from '@/database/prisma.service';
import { QuietHoursWindow } from '@/push/types/quietHoursWindow';
import { Injectable } from '@nestjs/common';
import { PushSettings } from '@prisma/client';

@Injectable()
export class PushSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUser(userId: string): Promise<PushSettings | null> {
    return await this.prisma.pushSettings.findUnique({ where: { userId } });
  }

  async upsertQuietHours(
    userId: string,
    window: QuietHoursWindow,
  ): Promise<void> {
    const data = {
      quietHoursEnabled: window.enabled,
      quietStartMinute: window.startMinute,
      quietEndMinute: window.endMinute,
    };
    await this.prisma.pushSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  async upsertDiaryReminderMinute(
    userId: string,
    minute: number,
  ): Promise<void> {
    await this.prisma.pushSettings.upsert({
      where: { userId },
      create: { userId, diaryReminderMinute: minute },
      update: { diaryReminderMinute: minute },
    });
  }

  // Atomic and once per account: only the call that flips the column from
  // null reports true, so two concurrent claims never both show the invite.
  async claimInvitation(userId: string, at: Date): Promise<boolean> {
    await this.prisma.pushSettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    const { count } = await this.prisma.pushSettings.updateMany({
      where: { userId, invitationShownAt: null },
      data: { invitationShownAt: at },
    });
    return count > 0;
  }
}
