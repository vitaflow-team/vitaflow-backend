import { NotificationsService } from '@/notifications/notifications.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import {
  WORKOUT_PLAN_LINK,
  WorkoutNotificationsService,
} from './workoutNotifications.service';

const clients = { findOwnedById: jest.fn() };
const users = { findUnique: jest.fn() };
const workouts = { claimEditNotification: jest.fn() };
const notifications = { create: jest.fn() };

describe('WorkoutNotificationsService', () => {
  let service: WorkoutNotificationsService;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    clients.findOwnedById.mockResolvedValue({ id: 'c1', userId: 'user-1' });
    users.findUnique.mockResolvedValue({ name: 'Thiago Ramos' });
    workouts.claimEditNotification.mockResolvedValue(true);
    notifications.create.mockResolvedValue({});
    service = new WorkoutNotificationsService(
      notifications as unknown as NotificationsService,
      clients as unknown as ClientsRepository,
      users as unknown as UserRepository,
      workouts as unknown as EducatorWorkoutsRepository,
    );
    jest.spyOn(service['logger'], 'log').mockImplementation(() => {});
    errorLog = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => {});
  });

  it('UT-054 notifies once after a save whose claim succeeds', async () => {
    await service.notifyEdited('edu-1', 'c1', 'w1');

    expect(workouts.claimEditNotification).toHaveBeenCalledWith(
      'w1',
      expect.any(Date),
      30,
    );
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create).toHaveBeenCalledWith(
      'user-1',
      'WORKOUT_PLAN',
      expect.stringContaining('Thiago Ramos'),
      WORKOUT_PLAN_LINK,
    );
    expect(WORKOUT_PLAN_LINK).toBe('/restrict/workouts?plano=educador');
  });

  it('UT-055 sends nothing when the claim fails inside the window', async () => {
    workouts.claimEditNotification.mockResolvedValue(false);

    await service.notifyEdited('edu-1', 'c1', 'w1');

    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('UT-057 always notifies on activation, without asking for the edit window', async () => {
    await service.notifyActivated('edu-1', 'c1', 'w1');

    expect(workouts.claimEditNotification).not.toHaveBeenCalled();
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });

  it('UT-058 sends nothing and raises nothing for a record with no linked user', async () => {
    clients.findOwnedById.mockResolvedValue({ id: 'c1', userId: null });

    await expect(
      service.notifyActivated('edu-1', 'c1', 'w1'),
    ).resolves.toBeUndefined();
    await expect(
      service.notifyEdited('edu-1', 'c1', 'w1'),
    ).resolves.toBeUndefined();

    expect(notifications.create).not.toHaveBeenCalled();
    expect(workouts.claimEditNotification).not.toHaveBeenCalled();
  });

  it('UT-059 swallows a notification failure after the commit and logs it', async () => {
    notifications.create.mockRejectedValue(new Error('mail down'));

    await expect(
      service.notifyActivated('edu-1', 'c1', 'w1'),
    ).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('workout_notification_failed'),
    );
  });

  it('UT-060 words an activation as an activation and an edit as an update, with no workout content', async () => {
    await service.notifyActivated('edu-1', 'c1', 'w1');
    await service.notifyEdited('edu-1', 'c1', 'w1');

    const [activation, edit] = notifications.create.mock.calls.map(
      (call) => call[2] as string,
    );
    expect(activation).toMatch(/ativou/);
    expect(edit).toMatch(/atualizou/);
    for (const message of [activation, edit]) {
      expect(message).toContain('Thiago Ramos');
      expect(message).not.toMatch(/kg|séries|vídeo|http/i);
    }
  });

  it('UT-061 creates nothing for a record that no longer exists', async () => {
    clients.findOwnedById.mockResolvedValue(null);

    await service.notifyActivated('edu-1', 'c1', 'w1');
    await service.notifyEdited('edu-1', 'c1', 'w1');

    expect(notifications.create).not.toHaveBeenCalled();
  });
});
