import { NotificationCategory } from '@prisma/client';

export interface PushCategoryStateResponse {
  category: NotificationCategory;
  enabled: boolean;
}

export interface QuietHoursResponse {
  enabled: boolean;
  start: string;
  end: string;
}

// When push is not configured only `enabled: false` is present.
export interface PushSettingsResponse {
  enabled: boolean;
  publicKey?: string;
  categories?: PushCategoryStateResponse[];
  quietHours?: QuietHoursResponse;
  diaryReminderTime?: string;
}
