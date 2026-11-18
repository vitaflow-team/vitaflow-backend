import { PushCategoryPreferenceRepository } from '@/repositories/push/pushCategoryPreference.repository';
import { PushSettingsRepository } from '@/repositories/push/pushSettings.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { Injectable } from '@nestjs/common';
import { NotificationCategory, ProductType } from '@prisma/client';
import { formatClockTime, parseClockTime } from './clockTime';
import { InvitationClaimResponse } from './dto/invitationClaimResponse.Dto';
import { PushSettingsResponse } from './dto/pushSettingsResponse.Dto';
import { REMINDER_STEP_MINUTES } from './pushLimits';
import {
  applicablePushCategories,
  resolvePushPreference,
} from './pushPreferences';
import { DEFAULT_QUIET_HOURS } from './quietHours';
import { WebPushClient } from './webPush.client';

const INVALID_TIME = 'Horário inválido.';
const INVALID_REMINDER_STEP =
  'O horário do lembrete deve ser um múltiplo de 15 minutos.';
const INVALID_CATEGORY = 'Categoria indisponível para push nesta conta.';
export const DEFAULT_DIARY_REMINDER_MINUTE = 19 * 60;

export interface QuietHoursInput {
  enabled: boolean;
  start: string;
  end: string;
}

@Injectable()
export class PushSettingsService {
  constructor(
    private readonly categoryPreferences: PushCategoryPreferenceRepository,
    private readonly settings: PushSettingsRepository,
    private readonly users: UserRepository,
    private readonly webPush: WebPushClient,
  ) {}

  async getSettings(userId: string): Promise<PushSettingsResponse> {
    const publicKey = this.webPush.getPublicKey();
    if (!publicKey) return { enabled: false };

    const productType = await this.productTypeOf(userId);
    const [overrides, row] = await Promise.all([
      this.categoryPreferences.findAllByUser(userId),
      this.settings.findByUser(userId),
    ]);
    const overrideByCategory = new Map(
      overrides.map((item) => [item.category, item.enabled]),
    );

    return {
      enabled: true,
      publicKey,
      categories: applicablePushCategories(productType).map((category) => ({
        category,
        enabled: resolvePushPreference({
          category,
          productType,
          override: overrideByCategory.get(category),
        }),
      })),
      quietHours: {
        enabled: row?.quietHoursEnabled ?? DEFAULT_QUIET_HOURS.enabled,
        start: formatClockTime(
          row?.quietStartMinute ?? DEFAULT_QUIET_HOURS.startMinute,
        ),
        end: formatClockTime(
          row?.quietEndMinute ?? DEFAULT_QUIET_HOURS.endMinute,
        ),
      },
      diaryReminderTime: formatClockTime(
        row?.diaryReminderMinute ?? DEFAULT_DIARY_REMINDER_MINUTE,
      ),
    };
  }

  async setCategory(
    userId: string,
    category: NotificationCategory,
    enabled: boolean,
  ): Promise<void> {
    const productType = await this.productTypeOf(userId);
    if (!applicablePushCategories(productType).includes(category)) {
      throw new AppError(INVALID_CATEGORY, 400);
    }
    await this.categoryPreferences.upsert(userId, category, enabled);
  }

  async setQuietHours(userId: string, input: QuietHoursInput): Promise<void> {
    const startMinute = parseClockTime(input.start);
    const endMinute = parseClockTime(input.end);
    if (startMinute === null || endMinute === null) {
      throw new AppError(INVALID_TIME, 400);
    }
    await this.settings.upsertQuietHours(userId, {
      enabled: input.enabled,
      startMinute,
      endMinute,
    });
  }

  async setDiaryReminder(userId: string, time: string): Promise<void> {
    const minute = parseClockTime(time);
    if (minute === null) throw new AppError(INVALID_TIME, 400);
    if (minute % REMINDER_STEP_MINUTES !== 0) {
      throw new AppError(INVALID_REMINDER_STEP, 400);
    }
    await this.settings.upsertDiaryReminderMinute(userId, minute);
  }

  async claimInvitation(userId: string): Promise<InvitationClaimResponse> {
    return { show: await this.settings.claimInvitation(userId, new Date()) };
  }

  private async productTypeOf(userId: string): Promise<ProductType | null> {
    const types = await this.users.findProductTypesByIds([userId]);
    return types.get(userId) ?? null;
  }
}
