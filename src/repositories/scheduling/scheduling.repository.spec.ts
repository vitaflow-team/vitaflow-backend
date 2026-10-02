import { PrismaService } from '@/database/prisma.service';
import { SchedulingRepository } from './scheduling.repository';

describe('SchedulingRepository', () => {
  const create = jest.fn();
  const findUnique = jest.fn();
  const deleteFn = jest.fn();
  const windowFindMany = jest.fn();
  const createMany = jest.fn();
  const deleteMany = jest.fn();
  const findMany = jest.fn();
  const slotFindUnique = jest.fn();
  const updateMany = jest.fn();
  const update = jest.fn();

  const prisma = {
    availabilityWindow: {
      create,
      findUnique,
      delete: deleteFn,
      findMany: windowFindMany,
    },
    slot: {
      createMany,
      deleteMany,
      findMany,
      findUnique: slotFindUnique,
      updateMany,
      update,
    },
  } as unknown as PrismaService;

  const repository = new SchedulingRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createWindow', () => {
    it('creates a window with the given fields', async () => {
      create.mockResolvedValue({ id: 'window-1' });

      await repository.createWindow('professional-1', 1, 540, 720, 45);

      expect(create).toHaveBeenCalledWith({
        data: {
          professionalId: 'professional-1',
          dayOfWeek: 1,
          startMinute: 540,
          endMinute: 720,
          sessionDurationMinutes: 45,
        },
      });
    });
  });

  describe('findWindowsByProfessional', () => {
    it('lists the professional’s windows, ordered by day then start time', async () => {
      windowFindMany.mockResolvedValue([]);

      await repository.findWindowsByProfessional('professional-1');

      expect(windowFindMany).toHaveBeenCalledWith({
        where: { professionalId: 'professional-1' },
        orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      });
    });
  });

  describe('findWindowById', () => {
    it('returns null when no such window exists', async () => {
      findUnique.mockResolvedValue(null);

      const result = await repository.findWindowById('missing');

      expect(result).toBeNull();
      expect(findUnique).toHaveBeenCalledWith({ where: { id: 'missing' } });
    });
  });

  describe('deleteWindow', () => {
    it('deletes the window by id', async () => {
      await repository.deleteWindow('window-1');

      expect(deleteFn).toHaveBeenCalledWith({ where: { id: 'window-1' } });
    });
  });

  describe('createSlots', () => {
    it('skips the write entirely for an empty list', async () => {
      const count = await repository.createSlots([]);

      expect(count).toBe(0);
      expect(createMany).not.toHaveBeenCalled();
    });

    it('creates slots with skipDuplicates, relying on the @@unique constraint for idempotency', async () => {
      createMany.mockResolvedValue({ count: 2 });
      const slots = [
        {
          professionalId: 'professional-1',
          availabilityWindowId: 'window-1',
          startAt: new Date('2026-10-05T12:00:00Z'),
          endAt: new Date('2026-10-05T12:45:00Z'),
        },
      ];

      const count = await repository.createSlots(slots);

      expect(count).toBe(2);
      expect(createMany).toHaveBeenCalledWith({
        data: slots,
        skipDuplicates: true,
      });
    });
  });

  describe('deleteFutureOpenSlotsByWindow', () => {
    it('only deletes OPEN, future slots from the given window', async () => {
      const now = new Date('2026-10-01T12:00:00Z');

      await repository.deleteFutureOpenSlotsByWindow('window-1', now);

      expect(deleteMany).toHaveBeenCalledWith({
        where: {
          availabilityWindowId: 'window-1',
          status: 'OPEN',
          startAt: { gt: now },
        },
      });
    });
  });

  describe('findOpenSlots', () => {
    it('returns [] when nothing matches, not an error', async () => {
      findMany.mockResolvedValue([]);
      const from = new Date('2026-10-01T00:00:00Z');
      const to = new Date('2026-10-28T00:00:00Z');

      const result = await repository.findOpenSlots('professional-1', from, to);

      expect(result).toEqual([]);
      expect(findMany).toHaveBeenCalledWith({
        where: {
          professionalId: 'professional-1',
          status: 'OPEN',
          startAt: { gte: from, lte: to },
        },
        orderBy: { startAt: 'asc' },
      });
    });
  });

  describe('findSlotById', () => {
    it('returns null when no such slot exists', async () => {
      slotFindUnique.mockResolvedValue(null);

      const result = await repository.findSlotById('missing');

      expect(result).toBeNull();
      expect(slotFindUnique).toHaveBeenCalledWith({ where: { id: 'missing' } });
    });
  });

  describe('claimSlot', () => {
    it('issues an atomic conditional update scoped to status OPEN', async () => {
      updateMany.mockResolvedValue({ count: 1 });

      const count = await repository.claimSlot(
        'slot-1',
        'user-1',
        'PRESENCIAL',
      );

      expect(count).toBe(1);
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'slot-1', status: 'OPEN' },
        data: { status: 'BOOKED', userId: 'user-1', type: 'PRESENCIAL' },
      });
    });

    it('returns 0 when the slot was already claimed by someone else', async () => {
      updateMany.mockResolvedValue({ count: 0 });

      const count = await repository.claimSlot('slot-1', 'user-1', 'ONLINE');

      expect(count).toBe(0);
    });
  });

  describe('reopenSlot', () => {
    it('resets status, userId, type, onlineLink, and reminderSentAt', async () => {
      await repository.reopenSlot('slot-1');

      expect(update).toHaveBeenCalledWith({
        where: { id: 'slot-1' },
        data: {
          status: 'OPEN',
          userId: null,
          type: null,
          onlineLink: null,
          reminderSentAt: null,
        },
      });
    });
  });

  describe('setOnlineLink', () => {
    it('updates the link with no validation of its contents', async () => {
      update.mockResolvedValue({
        id: 'slot-1',
        onlineLink: 'not a url at all',
      });

      const result = await repository.setOnlineLink(
        'slot-1',
        'not a url at all',
      );

      expect(result.onlineLink).toBe('not a url at all');
      expect(update).toHaveBeenCalledWith({
        where: { id: 'slot-1' },
        data: { onlineLink: 'not a url at all' },
      });
    });
  });

  describe('findUpcomingForActor', () => {
    it('matches the actor as either professional or booking user', async () => {
      findMany.mockResolvedValue([]);
      const now = new Date('2026-10-01T12:00:00Z');

      await repository.findUpcomingForActor('actor-1', now);

      expect(findMany).toHaveBeenCalledWith({
        where: {
          status: 'BOOKED',
          startAt: { gte: now },
          OR: [{ professionalId: 'actor-1' }, { userId: 'actor-1' }],
        },
        include: {
          user: { select: { id: true, name: true } },
          professional: { select: { id: true, name: true } },
        },
        orderBy: { startAt: 'asc' },
      });
    });
  });

  describe('findDueForReminder', () => {
    it('matches BOOKED, unreminded slots within the given window', async () => {
      findMany.mockResolvedValue([]);
      const windowStart = new Date('2026-10-01T12:55:00Z');
      const windowEnd = new Date('2026-10-01T13:05:00Z');

      await repository.findDueForReminder(windowStart, windowEnd);

      expect(findMany).toHaveBeenCalledWith({
        where: {
          status: 'BOOKED',
          startAt: { gte: windowStart, lte: windowEnd },
          reminderSentAt: null,
        },
        include: {
          user: { select: { id: true, name: true } },
          professional: { select: { id: true, name: true } },
        },
      });
    });
  });

  describe('claimReminder', () => {
    it('atomically claims the right to send, scoped to reminderSentAt: null', async () => {
      updateMany.mockResolvedValue({ count: 1 });
      const sentAt = new Date('2026-10-01T13:00:00Z');

      const count = await repository.claimReminder('slot-1', sentAt);

      expect(count).toBe(1);
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'slot-1', reminderSentAt: null },
        data: { reminderSentAt: sentAt },
      });
    });

    it('returns 0 when a reminder was already sent for this slot', async () => {
      updateMany.mockResolvedValue({ count: 0 });

      const count = await repository.claimReminder('slot-1', new Date());

      expect(count).toBe(0);
    });
  });
});
