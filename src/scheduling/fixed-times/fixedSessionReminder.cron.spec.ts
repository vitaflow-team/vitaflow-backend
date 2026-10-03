import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { NotificationsService } from '@/notifications/notifications.service';
import { Clock } from '../clock.service';
import { FixedSessionReminderCron } from './fixedSessionReminder.cron';

const NOW = new Date('2026-10-12T09:05:00Z');

function due(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    clientId: 'client-1',
    startAt: new Date('2026-10-12T10:00:00Z'),
    workoutLetter: 'A',
    client: { id: 'client-1', name: 'Diego', userId: 'student-user' },
    professional: { id: 'educator-1', name: 'Thiago' },
    ...overrides,
  };
}

describe('FixedSessionReminderCron (UT-068 to UT-070)', () => {
  let repo: Record<string, jest.Mock>;
  let workouts: { findActiveByClient: jest.Mock };
  let notifications: { create: jest.Mock };
  let cron: FixedSessionReminderCron;

  beforeEach(() => {
    repo = {
      findDueFixedReminders: jest.fn().mockResolvedValue([due()]),
      claimFixedReminder: jest.fn().mockResolvedValue(1),
    };
    workouts = {
      findActiveByClient: jest
        .fn()
        .mockResolvedValue({ sessions: [{ name: 'Peito' }] }),
    };
    notifications = { create: jest.fn().mockResolvedValue({}) };
    cron = new FixedSessionReminderCron(
      repo as unknown as FixedTimesRepository,
      workouts as unknown as EducatorWorkoutsRepository,
      notifications as unknown as NotificationsService,
      { now: () => NOW } as Clock,
    );
  });

  it('UT-068 reminds both sides and names the linked session when the letter resolves', async () => {
    await cron.sendDueFixedReminders();

    expect(repo.claimFixedReminder).toHaveBeenCalledWith('session-1', NOW);
    const messages = notifications.create.mock.calls.map(
      (call): [unknown, unknown] => [call[0], call[2]],
    );
    expect(messages).toEqual([
      [
        'student-user',
        expect.stringContaining('Sua sessão A (Peito) com Thiago'),
      ],
      ['educator-1', expect.stringContaining('Sua sessão A (Peito) com Diego')],
    ]);
  });

  it('UT-068 uses the plain copy when the letter does not resolve', async () => {
    workouts.findActiveByClient.mockResolvedValue(null);

    await cron.sendDueFixedReminders();

    expect(notifications.create.mock.calls[0][2]).toMatch(
      /^Sua sessão com Thiago começa às \d{2}\/\d{2}, 07:00\.$/,
    );
  });

  it('UT-068 a record without an account reminds only the educator', async () => {
    repo.findDueFixedReminders.mockResolvedValue([
      due({ client: { id: 'client-1', name: 'Diego', userId: null } }),
    ]);

    await cron.sendDueFixedReminders();

    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create.mock.calls[0][0]).toBe('educator-1');
  });

  it('UT-070 a claim already made sends nothing', async () => {
    repo.claimFixedReminder.mockResolvedValue(0);

    await cron.sendDueFixedReminders();

    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('UT-069 the window query starts 55 and ends 65 minutes from now', async () => {
    await cron.sendDueFixedReminders();

    const [start, end] = repo.findDueFixedReminders.mock.calls[0];
    expect(start.getTime() - NOW.getTime()).toBe(55 * 60 * 1000);
    expect(end.getTime() - NOW.getTime()).toBe(65 * 60 * 1000);
  });
});
