import { NotificationCategory, SessionType } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { UserRepository } from '@/repositories/users/user.repository';
import { NotificationsService } from '@/notifications/notifications.service';
import {
  FixedTimeNotificationsService,
  scheduleChangeMessage,
} from './fixedTimeNotifications.service';

const RULE = {
  weekday: 1,
  startMinute: 7 * 60,
  type: SessionType.ONLINE,
};

describe('scheduleChangeMessage (UT-091)', () => {
  it('names the educator, weekday, time and type for create, change and removal', () => {
    expect(scheduleChangeMessage('created', 'Thiago', RULE)).toBe(
      'Thiago marcou um horário fixo: segunda-feira às 07:00, online.',
    );
    expect(
      scheduleChangeMessage('changed', 'Thiago', {
        ...RULE,
        startMinute: 1050,
      }),
    ).toBe(
      'Thiago alterou o seu horário fixo: segunda-feira às 17:30, online.',
    );
    expect(
      scheduleChangeMessage('removed', 'Thiago', {
        ...RULE,
        type: SessionType.PRESENCIAL,
        weekday: 7,
      }),
    ).toBe('Thiago removeu o seu horário fixo: domingo às 07:00, presencial.');
  });

  it('contains no other personal data', () => {
    const message = scheduleChangeMessage('created', 'Thiago', RULE);

    expect(message).not.toMatch(/@|\+55|CPF|Diego/);
  });
});

describe('FixedTimeNotificationsService (UT-032, UT-033)', () => {
  let notifications: { create: jest.Mock };
  let users: { findUnique: jest.Mock };
  let service: FixedTimeNotificationsService;

  beforeEach(() => {
    notifications = { create: jest.fn().mockResolvedValue({}) };
    users = { findUnique: jest.fn().mockResolvedValue({ name: 'Thiago' }) };
    service = new FixedTimeNotificationsService(
      notifications as unknown as NotificationsService,
      users as unknown as UserRepository,
    );
  });

  it('creates one SCHEDULE_CHANGE notice for the linked student with the scheduling link', async () => {
    await service.notify({
      educatorId: 'e1',
      userId: 'u1',
      kind: 'created',
      rule: RULE,
    });

    expect(notifications.create).toHaveBeenCalledWith(
      'u1',
      NotificationCategory.SCHEDULE_CHANGE,
      'Thiago marcou um horário fixo: segunda-feira às 07:00, online.',
      '/restrict/scheduling',
    );
  });

  it('UT-032 creates nothing for a record without an account', async () => {
    await service.notify({
      educatorId: 'e1',
      userId: null,
      kind: 'created',
      rule: RULE,
    });

    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('UT-033 logs and swallows a failing notification service', async () => {
    notifications.create.mockRejectedValue(new Error('mail down'));
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});

    await expect(
      service.notify({
        educatorId: 'e1',
        userId: 'u1',
        kind: 'changed',
        rule: RULE,
      }),
    ).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('schedule_change_notification_failed'),
    );
    logError.mockRestore();
  });
});
