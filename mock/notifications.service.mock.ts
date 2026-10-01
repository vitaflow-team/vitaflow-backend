import { NotificationsService } from '@/notifications/notifications.service';

export const notificationsServiceMock = {
  provide: NotificationsService,
  useValue: {
    create: jest.fn(),
    listForUser: jest.fn(),
    markRead: jest.fn(),
    getUnreadCount: jest.fn(),
    getPreferences: jest.fn(),
    setPreference: jest.fn(),
  },
};
