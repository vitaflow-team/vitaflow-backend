import { NotificationCategory } from '@prisma/client';
import {
  applicablePushCategories,
  DEFAULT_PUSH_PREFERENCES,
  resolvePushPreference,
} from './pushPreferences';

const resolveForStudent = (category: NotificationCategory): boolean =>
  resolvePushPreference({
    category,
    productType: 'USER',
    override: undefined,
  });

describe('push preferences', () => {
  it('UT-017 falls back to the documented defaults', () => {
    expect(resolveForStudent('MESSAGES')).toBe(true);
    expect(resolveForStudent('DIARY_REMINDER')).toBe(true);
    expect(resolveForStudent('CHECKIN_ABSENCE')).toBe(true);
    expect(resolveForStudent('BILLING')).toBe(false);
    expect(resolveForStudent('PRODUCT_NEWS')).toBe(false);
  });

  it('UT-017 keeps professional and gym alerts off by default', () => {
    expect(DEFAULT_PUSH_PREFERENCES.ACADEMIA_ACTIVITY).toBe(false);
    expect(DEFAULT_PUSH_PREFERENCES.CHURN_RISK_ALERT).toBe(false);
  });

  it('UT-018 lets an override win in both directions', () => {
    expect(
      resolvePushPreference({
        category: 'MESSAGES',
        productType: 'USER',
        override: false,
      }),
    ).toBe(false);
    expect(
      resolvePushPreference({
        category: 'BILLING',
        productType: 'USER',
        override: true,
      }),
    ).toBe(true);
  });

  it('UT-019 gives a category without a row its default', () => {
    expect(resolveForStudent('DIARY_REMINDER')).toBe(
      DEFAULT_PUSH_PREFERENCES.DIARY_REMINDER,
    );
  });

  it('UT-020 is off for a category the account type cannot receive', () => {
    expect(
      resolvePushPreference({
        category: 'CHURN_RISK_ALERT',
        productType: 'USER',
        override: true,
      }),
    ).toBe(false);
  });

  it('treats an account without a product as a student', () => {
    expect(applicablePushCategories(null)).toContain('DIARY_REMINDER');
    expect(applicablePushCategories('NUTRITIONIST')).not.toContain(
      'DIARY_REMINDER',
    );
    expect(applicablePushCategories('ACADEMIA')).toContain('ACADEMIA_ACTIVITY');
  });
});
