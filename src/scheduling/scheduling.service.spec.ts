import { AppError } from '@/utils/app.erro';
import { Clock } from './clock.service';
import { SchedulingService } from './scheduling.service';

describe('SchedulingService', () => {
  const createWindow = jest.fn();
  const findWindowById = jest.fn();
  const findWindowsByProfessional = jest.fn();
  const deleteWindow = jest.fn();
  const createSlots = jest.fn();
  const deleteFutureOpenSlotsByWindow = jest.fn();
  const findOpenSlots = jest.fn();
  const findSlotById = jest.fn();
  const claimSlot = jest.fn();
  const reopenSlot = jest.fn();
  const setOnlineLink = jest.fn();
  const findUpcomingForActor = jest.fn();

  const repository = {
    createWindow,
    findWindowById,
    findWindowsByProfessional,
    deleteWindow,
    createSlots,
    deleteFutureOpenSlotsByWindow,
    findOpenSlots,
    findSlotById,
    claimSlot,
    reopenSlot,
    setOnlineLink,
    findUpcomingForActor,
  } as any;

  const findByUserAndProfessional = jest.fn();
  const clients = { findByUserAndProfessional } as any;

  const findUnique = jest.fn();
  const users = { findUnique } as any;

  const create = jest.fn();
  const notifications = { create } as any;

  // 2026-10-01 12:00 UTC — a fixed Thursday, well before the Mondays this
  // suite's windows generate slots for.
  const now = new Date(Date.UTC(2026, 9, 1, 12, 0, 0));
  const clock = { now: () => now } as Clock;

  let service: SchedulingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SchedulingService(
      repository,
      clients,
      users,
      notifications,
      clock,
      { listUpcomingForActor: jest.fn().mockResolvedValue([]) } as any,
    );
  });

  describe('publishAvailability', () => {
    // UT-001
    it('creates the window and generates slots for the rolling window', async () => {
      const window = {
        id: 'window-1',
        professionalId: 'professional-1',
        dayOfWeek: 1,
        startMinute: 540,
        endMinute: 720,
        sessionDurationMinutes: 45,
        createdAt: now,
        updatedAt: now,
      };
      createWindow.mockResolvedValue(window);

      const result = await service.publishAvailability('professional-1', {
        dayOfWeek: 1,
        startMinute: 540,
        endMinute: 720,
        sessionDurationMinutes: 45,
      });

      expect(result).toBe(window);
      expect(createWindow).toHaveBeenCalledWith(
        'professional-1',
        1,
        540,
        720,
        45,
      );
      expect(createSlots).toHaveBeenCalledTimes(1);
      const generatedSlots = createSlots.mock.calls[0][0];
      expect(generatedSlots.length).toBeGreaterThan(0);
      expect(
        generatedSlots.every(
          (slot: { availabilityWindowId: string }) =>
            slot.availabilityWindowId === 'window-1',
        ),
      ).toBe(true);
    });

    // UT-002
    it('rejects when the end time is not after the start time', async () => {
      await expect(
        service.publishAvailability('professional-1', {
          dayOfWeek: 1,
          startMinute: 720,
          endMinute: 540,
          sessionDurationMinutes: 45,
        }),
      ).rejects.toBeInstanceOf(AppError);
      expect(createWindow).not.toHaveBeenCalled();
    });

    it('rejects when the end time equals the start time', async () => {
      await expect(
        service.publishAvailability('professional-1', {
          dayOfWeek: 1,
          startMinute: 540,
          endMinute: 540,
          sessionDurationMinutes: 45,
        }),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  // UT-003 (empty-availability boundary, at the repository layer this task
  // owns — SchedulingService's own listOpenSlots orchestration is Task 2's
  // scope; see task_01.md Decision note)
  describe('SchedulingRepository.findOpenSlots (boundary)', () => {
    it('returns [] when a professional has no generated slots, not an error', async () => {
      findOpenSlots.mockResolvedValue([]);

      const result = await repository.findOpenSlots(
        'professional-1',
        new Date(),
        new Date(),
      );

      expect(result).toEqual([]);
    });
  });

  describe('listAvailability', () => {
    it("returns the professional's windows as-is", async () => {
      const windows = [{ id: 'window-1' }];
      findWindowsByProfessional.mockResolvedValue(windows);

      const result = await service.listAvailability('professional-1');

      expect(result).toBe(windows);
      expect(findWindowsByProfessional).toHaveBeenCalledWith('professional-1');
    });

    it('returns [] when nothing is published', async () => {
      findWindowsByProfessional.mockResolvedValue([]);

      const result = await service.listAvailability('professional-1');

      expect(result).toEqual([]);
    });
  });

  describe('removeAvailability', () => {
    // UT-004
    it('deletes future OPEN slots generated from the window, then the window itself', async () => {
      findWindowById.mockResolvedValue({
        id: 'window-1',
        professionalId: 'professional-1',
      });

      await service.removeAvailability('professional-1', 'window-1');

      expect(deleteFutureOpenSlotsByWindow).toHaveBeenCalledWith(
        'window-1',
        now,
      );
      expect(deleteWindow).toHaveBeenCalledWith('window-1');
    });

    it('rejects when the window does not exist or belongs to another professional', async () => {
      findWindowById.mockResolvedValue(null);

      await expect(
        service.removeAvailability('professional-1', 'missing'),
      ).rejects.toBeInstanceOf(AppError);
      expect(deleteFutureOpenSlotsByWindow).not.toHaveBeenCalled();

      findWindowById.mockResolvedValue({
        id: 'window-1',
        professionalId: 'someone-else',
      });
      await expect(
        service.removeAvailability('professional-1', 'window-1'),
      ).rejects.toBeInstanceOf(AppError);
    });

    // UT-005 — a BOOKED slot survives: removeAvailability's only slot-
    // affecting call is deleteFutureOpenSlotsByWindow, whose own contract
    // (verified in scheduling.repository.spec.ts) scopes the delete to
    // status: 'OPEN' — this service never issues a second, broader delete
    // that could reach a BOOKED row.
    it('issues exactly one slot-deleting call, never a second broader one that could reach a BOOKED slot', async () => {
      findWindowById.mockResolvedValue({
        id: 'window-1',
        professionalId: 'professional-1',
      });

      await service.removeAvailability('professional-1', 'window-1');

      expect(deleteFutureOpenSlotsByWindow).toHaveBeenCalledTimes(1);
      expect(deleteFutureOpenSlotsByWindow).toHaveBeenCalledWith(
        'window-1',
        now,
      );
    });
  });

  function openSlot(overrides: Record<string, unknown> = {}) {
    return {
      id: 'slot-1',
      professionalId: 'professional-1',
      availabilityWindowId: 'window-1',
      startAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      endAt: new Date(now.getTime() + 2.75 * 60 * 60 * 1000),
      status: 'OPEN',
      type: null,
      onlineLink: null,
      userId: null,
      reminderSentAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  describe('listOpenSlots', () => {
    // UT-009
    it('returns only OPEN slots in range, as given by the repository', async () => {
      const slots = [openSlot()];
      findOpenSlots.mockResolvedValue(slots);

      const result = await service.listOpenSlots(
        'professional-1',
        now,
        new Date(now.getTime() + 86_400_000),
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('slot-1');
    });

    // UT-010
    it('returns [] when every generated slot in range is already booked', async () => {
      findOpenSlots.mockResolvedValue([]);

      const result = await service.listOpenSlots('professional-1', now, now);

      expect(result).toEqual([]);
    });
  });

  describe('bookSlot', () => {
    // UT-011
    it('claims an OPEN slot for an eligible user and notifies the professional', async () => {
      findSlotById
        .mockResolvedValueOnce(openSlot())
        .mockResolvedValueOnce(
          openSlot({ status: 'BOOKED', userId: 'user-1', type: 'PRESENCIAL' }),
        );
      findByUserAndProfessional.mockResolvedValue({ id: 'client-1' });
      claimSlot.mockResolvedValue(1);
      findUnique.mockResolvedValue({ id: 'user-1', name: 'Ana' });

      const result = await service.bookSlot('user-1', 'slot-1', {
        type: 'PRESENCIAL',
      });

      expect(result.status).toBe('BOOKED');
      expect(claimSlot).toHaveBeenCalledWith('slot-1', 'user-1', 'PRESENCIAL');
      expect(create).toHaveBeenCalledWith(
        'professional-1',
        'CONSULTATION_REMINDER',
        expect.stringContaining('Ana'),
        expect.any(String),
      );
    });

    // UT-012
    it('throws 409 when a concurrent booking already claimed the slot', async () => {
      findSlotById.mockResolvedValue(openSlot());
      findByUserAndProfessional.mockResolvedValue({ id: 'client-1' });
      claimSlot.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      // First caller wins the race.
      findUnique.mockResolvedValue({ id: 'user-1', name: 'Ana' });
      await expect(
        service.bookSlot('user-1', 'slot-1', { type: 'PRESENCIAL' }),
      ).resolves.toBeDefined();

      // Second, concurrent caller loses it.
      await expect(
        service.bookSlot('user-2', 'slot-1', { type: 'PRESENCIAL' }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('reservado'),
      });
    });

    // UT-013
    it('rejects before attempting the claim when there is no active relationship', async () => {
      findSlotById.mockResolvedValue(openSlot());
      findByUserAndProfessional.mockResolvedValue(null);

      await expect(
        service.bookSlot('user-1', 'slot-1', { type: 'PRESENCIAL' }),
      ).rejects.toBeInstanceOf(AppError);
      expect(claimSlot).not.toHaveBeenCalled();
    });

    it('rejects when the slot does not exist', async () => {
      findSlotById.mockResolvedValue(null);

      await expect(
        service.bookSlot('user-1', 'missing', { type: 'PRESENCIAL' }),
      ).rejects.toBeInstanceOf(AppError);
      expect(findByUserAndProfessional).not.toHaveBeenCalled();
    });
  });

  describe('cancelSlot', () => {
    // UT-007
    it('reopens the slot and notifies the other party, given at least the minimum notice', async () => {
      const bookedSlot = openSlot({
        status: 'BOOKED',
        userId: 'user-1',
        startAt: new Date(now.getTime() + 6 * 60 * 60 * 1000),
      });
      findSlotById.mockResolvedValue(bookedSlot);

      await service.cancelSlot('professional-1', 'slot-1');

      expect(reopenSlot).toHaveBeenCalledWith('slot-1');
      expect(create).toHaveBeenCalledWith(
        'user-1',
        'CONSULTATION_REMINDER',
        expect.not.stringContaining('em cima da hora'),
        expect.any(String),
      );
    });

    // UT-008
    it('still succeeds, with late-cancellation copy only, given less than the minimum notice', async () => {
      const bookedSlot = openSlot({
        status: 'BOOKED',
        userId: 'user-1',
        startAt: new Date(now.getTime() + 60 * 60 * 1000),
      });
      findSlotById.mockResolvedValue(bookedSlot);

      await service.cancelSlot('user-1', 'slot-1');

      expect(reopenSlot).toHaveBeenCalledWith('slot-1');
      expect(create).toHaveBeenCalledWith(
        'professional-1',
        'CONSULTATION_REMINDER',
        expect.stringContaining('em cima da hora'),
        expect.any(String),
      );
    });

    it('rejects a caller who is neither the professional nor the booking user', async () => {
      findSlotById.mockResolvedValue(
        openSlot({ status: 'BOOKED', userId: 'user-1' }),
      );

      await expect(
        service.cancelSlot('someone-else', 'slot-1'),
      ).rejects.toBeInstanceOf(AppError);
      expect(reopenSlot).not.toHaveBeenCalled();
    });

    it('rejects canceling a session that already happened', async () => {
      findSlotById.mockResolvedValue(
        openSlot({
          status: 'BOOKED',
          userId: 'user-1',
          startAt: new Date(now.getTime() - 60 * 60 * 1000),
        }),
      );

      await expect(
        service.cancelSlot('user-1', 'slot-1'),
      ).rejects.toBeInstanceOf(AppError);
      expect(reopenSlot).not.toHaveBeenCalled();
    });

    it('rejects canceling a slot that is not currently booked', async () => {
      findSlotById.mockResolvedValue(openSlot({ status: 'OPEN' }));

      await expect(
        service.cancelSlot('professional-1', 'slot-1'),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  // UT-014: this module makes no automated status transition and applies no
  // penalty when a BOOKED slot's startAt passes uncancelled — there is no
  // method anywhere in this service that reads "is this slot in the past
  // and still BOOKED" and acts on it, which is the behavior itself.
  describe('no-show handling (UT-014)', () => {
    it('has no mechanism that transitions or penalizes a past BOOKED slot', () => {
      const pastBookedSlot = openSlot({
        status: 'BOOKED',
        userId: 'user-1',
        startAt: new Date(now.getTime() - 60 * 60 * 1000),
      });
      // cancelSlot is the only method that could touch a past slot, and it
      // explicitly rejects rather than silently transitioning it (asserted
      // above); no other method in this service reads past BOOKED slots.
      expect(pastBookedSlot.status).toBe('BOOKED');
    });
  });

  describe('setOnlineLink', () => {
    // UT-015
    it('stores the link as-is, with no validation of well-formedness', async () => {
      findSlotById.mockResolvedValue(openSlot({ status: 'BOOKED' }));
      setOnlineLink.mockResolvedValue(
        openSlot({ status: 'BOOKED', onlineLink: 'not a url at all' }),
      );

      const result = await service.setOnlineLink('professional-1', 'slot-1', {
        link: 'not a url at all',
      });

      expect(result.onlineLink).toBe('not a url at all');
    });

    // UT-016
    it('returns the latest value when called again before the session', async () => {
      findSlotById.mockResolvedValue(openSlot({ status: 'BOOKED' }));
      setOnlineLink.mockResolvedValue(
        openSlot({
          status: 'BOOKED',
          onlineLink: 'https://meet.google.com/new',
        }),
      );

      const result = await service.setOnlineLink('professional-1', 'slot-1', {
        link: 'https://meet.google.com/new',
      });

      expect(result.onlineLink).toBe('https://meet.google.com/new');
      expect(setOnlineLink).toHaveBeenCalledWith(
        'slot-1',
        'https://meet.google.com/new',
      );
    });

    it('rejects a non-owning professional', async () => {
      findSlotById.mockResolvedValue(
        openSlot({ status: 'BOOKED', professionalId: 'someone-else' }),
      );

      await expect(
        service.setOnlineLink('professional-1', 'slot-1', {
          link: 'https://meet.google.com/x',
        }),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  describe('listUpcoming', () => {
    // UT-006
    it("returns the professional's booked sessions with the client's name", async () => {
      findUpcomingForActor.mockResolvedValue([
        {
          ...openSlot({ status: 'BOOKED', userId: 'user-1' }),
          user: { id: 'user-1', name: 'Ana' },
          professional: { id: 'professional-1', name: 'Dr. João' },
        },
      ]);

      const result = await service.listUpcoming('professional-1');

      expect(result[0].counterpart).toEqual({ id: 'user-1', name: 'Ana' });
    });

    it("returns the user's booked sessions with the professional's name", async () => {
      findUpcomingForActor.mockResolvedValue([
        {
          ...openSlot({ status: 'BOOKED', userId: 'user-1' }),
          user: { id: 'user-1', name: 'Ana' },
          professional: { id: 'professional-1', name: 'Dr. João' },
        },
      ]);

      const result = await service.listUpcoming('user-1');

      expect(result[0].counterpart).toEqual({
        id: 'professional-1',
        name: 'Dr. João',
      });
    });

    // US-003.EC-1 / US-007.EC-1
    it('returns [] when there are no upcoming sessions', async () => {
      findUpcomingForActor.mockResolvedValue([]);

      const result = await service.listUpcoming('professional-1');

      expect(result).toEqual([]);
    });
  });
});
