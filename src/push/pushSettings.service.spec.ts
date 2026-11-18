import { PushCategoryPreferenceRepository } from '@/repositories/push/pushCategoryPreference.repository';
import { PushSettingsRepository } from '@/repositories/push/pushSettings.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { ProductType } from '@prisma/client';
import { PushSettingsService } from './pushSettings.service';
import { WebPushClient } from './webPush.client';

function makeService(productType: ProductType | null = 'USER') {
  const categoryPreferences = {
    findAllByUser: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue({}),
  };
  const settings = {
    findByUser: jest.fn().mockResolvedValue(null),
    upsertQuietHours: jest.fn().mockResolvedValue(undefined),
    upsertDiaryReminderMinute: jest.fn().mockResolvedValue(undefined),
    claimInvitation: jest.fn(),
  };
  const users = {
    findProductTypesByIds: jest
      .fn()
      .mockResolvedValue(
        productType ? new Map([['u1', productType]]) : new Map(),
      ),
  };
  const webPush = {
    getPublicKey: jest.fn().mockReturnValue('public-key'),
  };
  const service = new PushSettingsService(
    categoryPreferences as unknown as PushCategoryPreferenceRepository,
    settings as unknown as PushSettingsRepository,
    users as unknown as UserRepository,
    webPush as unknown as WebPushClient,
  );
  return { service, categoryPreferences, settings, webPush };
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  const failure: unknown = await promise.catch((error: unknown) => error);
  return (failure as AppError).getStatus();
}

describe('PushSettingsService', () => {
  describe('getSettings', () => {
    it('UT-033 returns defaults for a user without stored rows', async () => {
      const { service } = makeService();

      const result = await service.getSettings('u1');

      expect(result.enabled).toBe(true);
      expect(result.publicKey).toBe('public-key');
      expect(result.quietHours).toEqual({
        enabled: true,
        start: '22:00',
        end: '07:00',
      });
      expect(result.diaryReminderTime).toBe('19:00');
      const byCategory = Object.fromEntries(
        result.categories!.map((item) => [item.category, item.enabled]),
      );
      expect(byCategory.MESSAGES).toBe(true);
      expect(byCategory.DIARY_REMINDER).toBe(true);
      expect(byCategory.BILLING).toBe(false);
    });

    it('UT-033 applies stored overrides and settings', async () => {
      const { service, categoryPreferences, settings } = makeService();
      categoryPreferences.findAllByUser.mockResolvedValue([
        { category: 'MESSAGES', enabled: false },
        { category: 'BILLING', enabled: true },
      ]);
      settings.findByUser.mockResolvedValue({
        quietHoursEnabled: false,
        quietStartMinute: 1260,
        quietEndMinute: 360,
        diaryReminderMinute: 1230,
      });

      const result = await service.getSettings('u1');

      const byCategory = Object.fromEntries(
        result.categories!.map((item) => [item.category, item.enabled]),
      );
      expect(byCategory.MESSAGES).toBe(false);
      expect(byCategory.BILLING).toBe(true);
      expect(result.quietHours).toEqual({
        enabled: false,
        start: '21:00',
        end: '06:00',
      });
      expect(result.diaryReminderTime).toBe('20:30');
    });

    it('reports only enabled false when push is not configured', async () => {
      const { service, webPush } = makeService();
      webPush.getPublicKey.mockReturnValue(null);

      expect(await service.getSettings('u1')).toEqual({ enabled: false });
    });

    it.each([
      [
        'USER',
        ['DIARY_REMINDER', 'CHECKIN_ABSENCE'],
        ['CHURN_RISK_ALERT', 'ACADEMIA_ACTIVITY'],
      ],
      [
        'PHYSICAL_EDUCATOR',
        ['CHURN_RISK_ALERT'],
        ['DIARY_REMINDER', 'CHECKIN_ABSENCE'],
      ],
      ['NUTRITIONIST', ['MESSAGES'], ['DIARY_REMINDER', 'CHECKIN_ABSENCE']],
      [
        'ACADEMIA',
        ['ACADEMIA_ACTIVITY', 'CHURN_RISK_ALERT'],
        ['DIARY_REMINDER'],
      ],
    ] as [ProductType, string[], string[]][])(
      'UT-034 shows %s the categories that apply to its account type',
      async (productType, included, excluded) => {
        const { service } = makeService(productType);

        const result = await service.getSettings('u1');
        const categories = result.categories!.map((item) => item.category);

        for (const category of included) expect(categories).toContain(category);
        for (const category of excluded) {
          expect(categories).not.toContain(category);
        }
      },
    );
  });

  describe('setCategory', () => {
    it('UT-035 stores the category state', async () => {
      const { service, categoryPreferences } = makeService();

      await service.setCategory('u1', 'MESSAGES', false);

      expect(categoryPreferences.upsert).toHaveBeenCalledWith(
        'u1',
        'MESSAGES',
        false,
      );
    });

    it('UT-036 rejects a category the account cannot receive', async () => {
      const { service, categoryPreferences } = makeService('USER');

      expect(
        await statusOf(service.setCategory('u1', 'CHURN_RISK_ALERT', true)),
      ).toBe(400);
      expect(categoryPreferences.upsert).not.toHaveBeenCalled();
    });

    it('UT-037 rejects WORKOUT_REMINDER, which has no producer', async () => {
      const { service } = makeService();

      expect(
        await statusOf(service.setCategory('u1', 'WORKOUT_REMINDER', true)),
      ).toBe(400);
    });
  });

  describe('setQuietHours', () => {
    it('UT-038 stores the window as minutes of the day', async () => {
      const { service, settings } = makeService();

      await service.setQuietHours('u1', {
        enabled: true,
        start: '22:00',
        end: '07:00',
      });

      expect(settings.upsertQuietHours).toHaveBeenCalledWith('u1', {
        enabled: true,
        startMinute: 1320,
        endMinute: 420,
      });
    });

    it('UT-039 rejects an invalid time and keeps the stored values', async () => {
      const { service, settings } = makeService();

      expect(
        await statusOf(
          service.setQuietHours('u1', {
            enabled: true,
            start: '24:00',
            end: '07:00',
          }),
        ),
      ).toBe(400);
      expect(settings.upsertQuietHours).not.toHaveBeenCalled();
    });

    it('UT-040 accepts equal start and end', async () => {
      const { service, settings } = makeService();

      await service.setQuietHours('u1', {
        enabled: true,
        start: '08:00',
        end: '08:00',
      });

      expect(settings.upsertQuietHours).toHaveBeenCalledWith('u1', {
        enabled: true,
        startMinute: 480,
        endMinute: 480,
      });
    });
  });

  describe('setDiaryReminder', () => {
    it('UT-041 stores a valid 15-minute step', async () => {
      const { service, settings } = makeService();

      await service.setDiaryReminder('u1', '19:15');

      expect(settings.upsertDiaryReminderMinute).toHaveBeenCalledWith(
        'u1',
        1155,
      );
    });

    it('UT-042 rejects a time that is not a multiple of 15 minutes', async () => {
      const { service, settings } = makeService();

      expect(await statusOf(service.setDiaryReminder('u1', '19:10'))).toBe(400);
      expect(settings.upsertDiaryReminderMinute).not.toHaveBeenCalled();
    });

    it('UT-043 accepts the day boundaries and rejects 23:59', async () => {
      const { service, settings } = makeService();

      await service.setDiaryReminder('u1', '00:00');
      await service.setDiaryReminder('u1', '23:45');

      expect(settings.upsertDiaryReminderMinute).toHaveBeenNthCalledWith(
        1,
        'u1',
        0,
      );
      expect(settings.upsertDiaryReminderMinute).toHaveBeenNthCalledWith(
        2,
        'u1',
        1425,
      );
      expect(await statusOf(service.setDiaryReminder('u1', '23:59'))).toBe(400);
    });
  });

  describe('claimInvitation', () => {
    it('UT-044 shows the invitation on the first claim', async () => {
      const { service, settings } = makeService();
      settings.claimInvitation.mockResolvedValue(true);

      expect(await service.claimInvitation('u1')).toEqual({ show: true });
      expect(settings.claimInvitation).toHaveBeenCalledWith(
        'u1',
        expect.any(Date),
      );
    });

    it('UT-045 does not show it again on a later claim', async () => {
      const { service, settings } = makeService();
      settings.claimInvitation.mockResolvedValue(false);

      expect(await service.claimInvitation('u1')).toEqual({ show: false });
    });

    it('UT-046 shows the invitation to exactly one of two simultaneous claims', async () => {
      const { service, settings } = makeService();
      settings.claimInvitation
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const results = await Promise.all([
        service.claimInvitation('u1'),
        service.claimInvitation('u1'),
      ]);

      expect(results.filter((result) => result.show)).toHaveLength(1);
    });
  });
});
