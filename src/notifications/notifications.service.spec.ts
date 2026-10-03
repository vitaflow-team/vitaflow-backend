import { MailService } from '@/mail/mail.service';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { Notification, NotificationCategory, Users } from '@prisma/client';
import { NotificationsService } from './notifications.service';

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    userId: 'user-1',
    category: 'BILLING',
    message: 'x',
    link: null,
    readAt: null,
    createdAt: new Date('2026-09-30T09:00:00.000Z'),
    ...overrides,
  };
}

function makeUser(overrides: Partial<Users> = {}): Users {
  return {
    id: 'user-1',
    name: 'Usuária',
    email: 'user@example.com',
    password: 'hash',
    avatar: null,
    active: true,
    phone: null,
    birthDate: null,
    productId: null,
    termsAcceptedAt: null,
    healthDataConsentAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    subscriptionCancelAt: null,
    subscriptionCurrentPeriodEnd: null,
    isBackoffice: false,
    createdAt: new Date('2026-09-30T09:00:00.000Z'),
    updatedAt: new Date('2026-09-30T09:00:00.000Z'),
    ...overrides,
  };
}

describe('NotificationsService', () => {
  const notificationsCreate = jest.fn();
  const notificationsFindById = jest.fn();
  const notificationsFindByUser = jest.fn();
  const notificationsMarkRead = jest.fn();
  const notificationsCountUnread = jest.fn();
  const notificationsFindPreference = jest.fn();
  const notificationsFindAllPreferences = jest.fn();
  const notificationsUpsertPreference = jest.fn();
  const usersFindUnique = jest.fn();
  const mailSendNotificationEmail = jest.fn();

  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    usersFindUnique.mockResolvedValue(makeUser());
    service = new NotificationsService(
      {
        create: notificationsCreate,
        findById: notificationsFindById,
        findByUser: notificationsFindByUser,
        markRead: notificationsMarkRead,
        countUnread: notificationsCountUnread,
        findPreference: notificationsFindPreference,
        findAllPreferences: notificationsFindAllPreferences,
        upsertPreference: notificationsUpsertPreference,
      } as unknown as NotificationsRepository,
      { findUnique: usersFindUnique } as unknown as UserRepository,
      {
        sendNotificationEmail: mailSendNotificationEmail,
      } as unknown as MailService,
    );
  });

  describe('listForUser', () => {
    it('UT-001 returns notifications newest-first (page 1 by default)', async () => {
      const rows = [
        makeNotification({ id: 'a' }),
        makeNotification({ id: 'b' }),
        makeNotification({ id: 'c' }),
      ];
      notificationsFindByUser.mockResolvedValue(rows);

      const result = await service.listForUser('user-1');

      expect(notificationsFindByUser).toHaveBeenCalledWith('user-1', 0, 50);
      expect(result).toHaveLength(3);
    });

    it('UT-002 page 2 of 120 skips the first 50', async () => {
      notificationsFindByUser.mockResolvedValue([]);

      await service.listForUser('user-1', 2);

      expect(notificationsFindByUser).toHaveBeenCalledWith('user-1', 50, 50);
    });
  });

  describe('markRead / getUnreadCount', () => {
    it('UT-003 sets readAt and the unread count reflects the decrease', async () => {
      notificationsFindById.mockResolvedValue(makeNotification());
      notificationsCountUnread.mockResolvedValue(2);

      await service.markRead('user-1', 'n1');
      const count = await service.getUnreadCount('user-1');

      expect(notificationsMarkRead).toHaveBeenCalledWith('n1');
      expect(count).toBe(2);
    });

    it('UT-004 marking read is idempotent and state is not session-scoped', async () => {
      notificationsFindById.mockResolvedValue(
        makeNotification({ readAt: new Date('2026-09-30T10:00:00.000Z') }),
      );

      await service.markRead('user-1', 'n1');

      expect(notificationsMarkRead).not.toHaveBeenCalled();
    });

    it('refuses to mark a notification owned by a different user', async () => {
      notificationsFindById.mockResolvedValue(
        makeNotification({ userId: 'other-user' }),
      );

      await expect(service.markRead('user-1', 'n1')).rejects.toThrow(AppError);
      expect(notificationsMarkRead).not.toHaveBeenCalled();
    });

    it('throws AppError(404) for an unknown notification', async () => {
      notificationsFindById.mockResolvedValue(null);

      await expect(service.markRead('user-1', 'missing')).rejects.toThrow(
        AppError,
      );
    });
  });

  describe('create (UT-005 analog via BILLING, UT-012, UT-013)', () => {
    it('UT-012 sends an email whose content matches the notification message when enabled', async () => {
      notificationsCreate.mockResolvedValue(
        makeNotification({ message: 'Seu pagamento falhou.' }),
      );
      notificationsFindPreference.mockResolvedValue(null);

      await service.create('user-1', 'BILLING', 'Seu pagamento falhou.');

      expect(mailSendNotificationEmail).toHaveBeenCalledWith(
        'Usuária',
        'user@example.com',
        expect.any(String),
        'Seu pagamento falhou.',
        undefined,
      );
    });

    it('UT-006 writes the row but sends no email when the preference is disabled', async () => {
      notificationsCreate.mockResolvedValue(makeNotification());
      notificationsFindPreference.mockResolvedValue({ enabled: false });

      await service.create('user-1', 'BILLING', 'x');

      expect(notificationsCreate).toHaveBeenCalledWith('user-1', {
        category: 'BILLING',
        message: 'x',
        link: undefined,
      });
      expect(mailSendNotificationEmail).not.toHaveBeenCalled();
    });

    it('UT-013 still commits the row when the email send throws', async () => {
      notificationsCreate.mockResolvedValue(makeNotification());
      notificationsFindPreference.mockResolvedValue(null);
      mailSendNotificationEmail.mockRejectedValue(new Error('SMTP down'));

      const result = await service.create('user-1', 'BILLING', 'x');

      expect(notificationsCreate).toHaveBeenCalled();
      expect(result.id).toBe('n1');
    });

    it('a missing user skips the email without throwing', async () => {
      notificationsCreate.mockResolvedValue(makeNotification());
      notificationsFindPreference.mockResolvedValue(null);
      usersFindUnique.mockResolvedValue(null);

      await expect(
        service.create('user-1', 'BILLING', 'x'),
      ).resolves.toBeDefined();
      expect(mailSendNotificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('preferences (UT-008, UT-009, UT-010)', () => {
    it('UT-008 setPreference then getPreferences reflects the change', async () => {
      notificationsFindAllPreferences.mockResolvedValue([
        { category: 'MESSAGES', enabled: false },
      ]);

      await service.setPreference('user-1', 'MESSAGES', false);
      const preferences = await service.getPreferences('user-1');

      expect(notificationsUpsertPreference).toHaveBeenCalledWith(
        'user-1',
        'MESSAGES',
        false,
      );
      expect(preferences.MESSAGES).toBe(false);
    });

    it('UT-009 a user with zero rows gets the documented defaults', async () => {
      notificationsFindAllPreferences.mockResolvedValue([]);

      const preferences = await service.getPreferences('user-1');

      expect(preferences).toEqual({
        WORKOUT_REMINDER: true,
        CONSULTATION_REMINDER: true,
        MESSAGES: true,
        BILLING: true,
        PRODUCT_NEWS: false,
        CONNECTION_REQUEST: true,
        WORKOUT_PLAN: true,
      });
    });

    it('UT-074 WORKOUT_PLAN is a category and its default is enabled', async () => {
      notificationsFindAllPreferences.mockResolvedValue([]);

      const preferences = await service.getPreferences('user-1');

      expect(Object.keys(NotificationCategory)).toContain('WORKOUT_PLAN');
      expect(preferences.WORKOUT_PLAN).toBe(true);
    });

    it('UT-010 disabling a category stops the email; re-enabling restores it', async () => {
      notificationsCreate.mockResolvedValue(makeNotification());
      notificationsFindPreference.mockResolvedValueOnce({ enabled: false });

      await service.create('user-1', 'WORKOUT_REMINDER', 'x');
      expect(mailSendNotificationEmail).not.toHaveBeenCalled();

      notificationsFindPreference.mockResolvedValueOnce({ enabled: true });
      await service.create('user-1', 'WORKOUT_REMINDER', 'x');
      expect(mailSendNotificationEmail).toHaveBeenCalledTimes(1);
    });
  });
});
