import { PrismaService } from '@/database/prisma.service';
import { PushCategoryPreferenceRepository } from './pushCategoryPreference.repository';
import { PushDeviceRepository } from './pushDevice.repository';
import { PushSettingsRepository } from './pushSettings.repository';

function makePrisma() {
  return {
    pushDevice: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    pushCategoryPreference: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
    },
    pushSettings: {
      findUnique: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn(),
    },
  };
}

describe('push repositories', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
  });

  describe('PushDeviceRepository', () => {
    const repository = () =>
      new PushDeviceRepository(prisma as unknown as PrismaService);

    it('upserts by endpoint so a device changes owner and becomes ACTIVE', async () => {
      await repository().upsertActive('u1', {
        endpoint: 'https://push.example/a',
        p256dh: 'k',
        auth: 'a',
        userAgent: 'UA',
      });

      const call = prisma.pushDevice.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ endpoint: 'https://push.example/a' });
      expect(call.update).toMatchObject({ userId: 'u1', status: 'ACTIVE' });
      expect(call.create).toMatchObject({
        endpoint: 'https://push.example/a',
        userId: 'u1',
      });
    });

    it('lists only ACTIVE devices of a user for sending', async () => {
      await repository().findActiveByUser('u1');

      expect(prisma.pushDevice.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', status: 'ACTIVE' },
      });
    });

    it('changes status only for the owner and the expected current status', async () => {
      const count = await repository().changeStatusForUser(
        'u1',
        'https://push.example/a',
        'ACTIVE',
        'LOGGED_OUT',
      );

      expect(count).toBe(1);
      expect(prisma.pushDevice.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          endpoint: 'https://push.example/a',
          status: 'ACTIVE',
        },
        data: { status: 'LOGGED_OUT' },
      });
    });

    it('does not touch the database when deleting no ids', async () => {
      await repository().deleteByIds([]);

      expect(prisma.pushDevice.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('PushCategoryPreferenceRepository', () => {
    it('upserts one row per user and category', async () => {
      await new PushCategoryPreferenceRepository(
        prisma as unknown as PrismaService,
      ).upsert('u1', 'MESSAGES', false);

      expect(prisma.pushCategoryPreference.upsert).toHaveBeenCalledWith({
        where: { userId_category: { userId: 'u1', category: 'MESSAGES' } },
        create: { userId: 'u1', category: 'MESSAGES', enabled: false },
        update: { enabled: false },
      });
    });
  });

  describe('PushSettingsRepository', () => {
    const repository = () =>
      new PushSettingsRepository(prisma as unknown as PrismaService);

    it('claims the invitation only when the column was still null', async () => {
      prisma.pushSettings.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.pushSettings.updateMany.mockResolvedValueOnce({ count: 0 });
      const at = new Date('2026-11-18T12:00:00Z');

      expect(await repository().claimInvitation('u1', at)).toBe(true);
      expect(await repository().claimInvitation('u1', at)).toBe(false);
      expect(prisma.pushSettings.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', invitationShownAt: null },
        data: { invitationShownAt: at },
      });
    });

    it('stores the quiet-hours window as minutes', async () => {
      await repository().upsertQuietHours('u1', {
        enabled: true,
        startMinute: 1320,
        endMinute: 420,
      });

      const call = prisma.pushSettings.upsert.mock.calls[0][0];
      expect(call.update).toEqual({
        quietHoursEnabled: true,
        quietStartMinute: 1320,
        quietEndMinute: 420,
      });
    });
  });
});
