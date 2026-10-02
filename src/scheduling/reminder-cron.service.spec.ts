import { Clock } from './clock.service';
import { ReminderCronService } from './reminder-cron.service';

describe('ReminderCronService', () => {
  const findDueForReminder = jest.fn();
  const claimReminder = jest.fn();
  const scheduling = { findDueForReminder, claimReminder } as any;

  const create = jest.fn();
  const notifications = { create } as any;

  // Fixed "now" — never relies on the real cron scheduler firing.
  const now = new Date('2026-10-01T12:00:00Z');
  const clock = { now: () => now } as Clock;

  let service: ReminderCronService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReminderCronService(scheduling, notifications, clock);
  });

  function dueSlot(overrides: Record<string, unknown> = {}) {
    return {
      id: 'slot-1',
      professionalId: 'professional-1',
      userId: 'user-1',
      startAt: new Date(now.getTime() + 60 * 60 * 1000),
      endAt: new Date(now.getTime() + 60 * 60 * 1000 + 45 * 60 * 1000),
      status: 'BOOKED',
      type: 'PRESENCIAL',
      onlineLink: null,
      reminderSentAt: null,
      createdAt: now,
      updatedAt: now,
      user: { id: 'user-1', name: 'Ana' },
      professional: { id: 'professional-1', name: 'Dr. João' },
      ...overrides,
    };
  }

  // UT-017
  it('queries the exact 55-65 minute window and notifies both parties for a due session', async () => {
    findDueForReminder.mockResolvedValue([dueSlot()]);
    claimReminder.mockResolvedValue(1);

    await service.sendDueReminders();

    expect(findDueForReminder).toHaveBeenCalledWith(
      new Date(now.getTime() + 55 * 60 * 1000),
      new Date(now.getTime() + 65 * 60 * 1000),
    );
    expect(claimReminder).toHaveBeenCalledWith('slot-1', now);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith(
      'user-1',
      'CONSULTATION_REMINDER',
      expect.stringContaining('Dr. João'),
      expect.any(String),
    );
    expect(create).toHaveBeenCalledWith(
      'professional-1',
      'CONSULTATION_REMINDER',
      expect.stringContaining('Ana'),
      expect.any(String),
    );
  });

  // UT-018
  it('never fires for a session booked less than an hour out — it never enters the due window, and there is no fallback', async () => {
    // A slot starting in 30 minutes simply never matches the repository's
    // 55-65 minute query — this test documents that this service makes no
    // separate check or fallback for short-notice bookings.
    findDueForReminder.mockResolvedValue([]);

    await service.sendDueReminders();

    expect(claimReminder).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('sends exactly one reminder, not two, across two invocations for the same due session', async () => {
    findDueForReminder.mockResolvedValue([dueSlot()]);
    claimReminder.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await service.sendDueReminders();
    await service.sendDueReminders();

    expect(create).toHaveBeenCalledTimes(2);
  });

  it('never sends a reminder for a session already canceled before the window (it is simply absent from the query result)', async () => {
    // A canceled slot has status: 'CANCELED', which findDueForReminder's
    // own status: 'BOOKED' filter already excludes — nothing in this
    // service re-checks status, by design.
    findDueForReminder.mockResolvedValue([]);

    await service.sendDueReminders();

    expect(create).not.toHaveBeenCalled();
  });
});
