import { NotificationCategory, ProductType } from '@prisma/client';

// Defaults once the user turns push on (push-notifications ADR-003): the
// actionable, personal categories are on; billing, news, and the
// professional alerts wait for an explicit choice. WORKOUT_REMINDER has no
// producer, so it is never offered.
export const DEFAULT_PUSH_PREFERENCES: Record<NotificationCategory, boolean> = {
  WORKOUT_REMINDER: false,
  CONSULTATION_REMINDER: true,
  MESSAGES: true,
  BILLING: false,
  PRODUCT_NEWS: false,
  CONNECTION_REQUEST: true,
  WORKOUT_PLAN: true,
  SCHEDULE_CHANGE: true,
  ACADEMIA_ACTIVITY: false,
  CHURN_RISK_ALERT: false,
  DIARY_REMINDER: true,
  CHECKIN_ABSENCE: true,
};

const STUDENT_CATEGORIES: NotificationCategory[] = [
  'MESSAGES',
  'CONSULTATION_REMINDER',
  'WORKOUT_PLAN',
  'SCHEDULE_CHANGE',
  'CONNECTION_REQUEST',
  'BILLING',
  'PRODUCT_NEWS',
  'DIARY_REMINDER',
  'CHECKIN_ABSENCE',
];

const PROFESSIONAL_CATEGORIES: NotificationCategory[] = [
  'MESSAGES',
  'CONSULTATION_REMINDER',
  'SCHEDULE_CHANGE',
  'CONNECTION_REQUEST',
  'BILLING',
  'PRODUCT_NEWS',
  'CHURN_RISK_ALERT',
];

const GYM_OWNER_CATEGORIES: NotificationCategory[] = [
  'MESSAGES',
  'BILLING',
  'PRODUCT_NEWS',
  'ACADEMIA_ACTIVITY',
  'CHURN_RISK_ALERT',
];

// The categories each account type can receive, and therefore the toggles it
// sees. An account with no product is a student.
export const PUSH_CATEGORIES_BY_PRODUCT_TYPE: Record<
  ProductType,
  NotificationCategory[]
> = {
  USER: STUDENT_CATEGORIES,
  NUTRITIONIST: PROFESSIONAL_CATEGORIES,
  PHYSICAL_EDUCATOR: PROFESSIONAL_CATEGORIES,
  ACADEMIA: GYM_OWNER_CATEGORIES,
};

export function applicablePushCategories(
  productType: ProductType | null | undefined,
): NotificationCategory[] {
  return PUSH_CATEGORIES_BY_PRODUCT_TYPE[productType ?? 'USER'];
}

export interface EffectivePushPreferenceInput {
  category: NotificationCategory;
  productType: ProductType | null | undefined;
  override: boolean | undefined;
}

// A category the account type cannot receive is always off, whatever a
// stale override row says.
export function resolvePushPreference({
  category,
  productType,
  override,
}: EffectivePushPreferenceInput): boolean {
  if (!applicablePushCategories(productType).includes(category)) return false;
  return override ?? DEFAULT_PUSH_PREFERENCES[category];
}
