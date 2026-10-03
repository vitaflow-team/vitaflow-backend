import { CodedError } from '@/common/errors/codedError';
import { NotificationsService } from '@/notifications/notifications.service';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { SessionType } from '@prisma/client';
import { Clock } from '../clock.service';
import { cancelCopy, FixedSessionsService } from './fixedSessions.service';

const NOW = new Date('2026-10-07T10:00:00Z');
const SESSION = 'session-1';

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION,
    fixedTimeId: 'fixed-1',
    clientId: 'client-1',
    professionalId: 'educator-1',
    startAt: new Date('2026-10-12T10:00:00Z'),
    endAt: new Date('2026-10-12T11:00:00Z'),
    status: 'SCHEDULED',
    type: SessionType.ONLINE,
    onlineLink: 'https://meet.test/a',
    workoutLetter: null,
    client: { id: 'client-1', name: 'Diego', userId: 'student-user' },
    professional: { id: 'educator-1', name: 'Thiago' },
    ...overrides,
  };
}

describe('FixedSessionsService', () => {
  let service: FixedSessionsService;
  let repo: Record<string, jest.Mock>;
  let workouts: { findActiveByClient: jest.Mock };
  let notifications: { create: jest.Mock };

  beforeEach(() => {
    repo = {
      findSessionWithParties: jest.fn().mockResolvedValue(sessionRow()),
      cancelSession: jest.fn().mockResolvedValue(1),
      setSessionLink: jest.fn().mockResolvedValue(undefined),
      findUpcomingFixedForActor: jest.fn().mockResolvedValue([]),
      findScheduledFromForClients: jest.fn().mockResolvedValue([]),
      findBookedFromForUsers: jest.fn().mockResolvedValue([]),
      findScheduledForClientBetween: jest.fn().mockResolvedValue([]),
    };
    workouts = { findActiveByClient: jest.fn().mockResolvedValue(null) };
    notifications = { create: jest.fn().mockResolvedValue({}) };
    service = new FixedSessionsService(
      repo as unknown as FixedTimesRepository,
      workouts as unknown as EducatorWorkoutsRepository,
      notifications as unknown as NotificationsService,
      { now: () => NOW } as Clock,
    );
  });

  async function errorOf(promise: Promise<unknown>): Promise<CodedError> {
    try {
      await promise;
    } catch (error) {
      return error as CodedError;
    }
    throw new Error('expected a rejection');
  }

  describe('cancel', () => {
    it('UT-050 the educator cancels and the student is told with the on-time copy', async () => {
      await service.cancel('educator-1', SESSION);

      expect(repo.cancelSession).toHaveBeenCalledWith(
        SESSION,
        'educator-1',
        NOW,
      );
      expect(notifications.create).toHaveBeenCalledWith(
        'student-user',
        'CONSULTATION_REMINDER',
        expect.stringContaining('foi cancelada.'),
        expect.stringContaining('/restrict/scheduling'),
      );
    });

    it('UT-050 uses the late copy with less than four hours of notice', () => {
      const soon = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
      expect(cancelCopy(soon, NOW)).toContain('em cima da hora');
      expect(
        cancelCopy(new Date(NOW.getTime() + 5 * 60 * 60 * 1000), NOW),
      ).not.toContain('em cima da hora');
    });

    it('UT-051 the linked student cancels and the educator is told', async () => {
      await service.cancel('student-user', SESSION);

      expect(notifications.create).toHaveBeenCalledWith(
        'educator-1',
        'CONSULTATION_REMINDER',
        expect.any(String),
        expect.stringContaining('/restrict/scheduling'),
      );
    });

    it('UT-052 an already canceled session answers 409 and sends nothing', async () => {
      repo.findSessionWithParties.mockResolvedValue(
        sessionRow({ status: 'CANCELED' }),
      );

      const error = await errorOf(service.cancel('educator-1', SESSION));

      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('session_not_cancelable');
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('UT-053 a session that started or ended answers 400', async () => {
      repo.findSessionWithParties.mockResolvedValue(
        sessionRow({ startAt: new Date('2026-10-07T09:00:00Z') }),
      );

      const error = await errorOf(service.cancel('educator-1', SESSION));

      expect(error.getStatus()).toBe(400);
      expect(error.code).toBe('session_not_cancelable');
    });

    it('UT-054 a different educator, a foreign student or a missing id answers 404', async () => {
      const foreign = await errorOf(service.cancel('educator-2', SESSION));
      expect(foreign.code).toBe('session_not_found');
      expect(foreign.getStatus()).toBe(404);

      repo.findSessionWithParties.mockResolvedValue(null);
      const missing = await errorOf(service.cancel('educator-1', 'unknown'));
      expect(missing.getResponse()).toEqual(foreign.getResponse());
    });

    it('UT-055 a record without an account sends no student notice; the educator is not told of their own action', async () => {
      repo.findSessionWithParties.mockResolvedValue(
        sessionRow({ client: { id: 'client-1', name: 'Diego', userId: null } }),
      );

      await service.cancel('educator-1', SESSION);

      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('UT-056 a simultaneous cancellation changes zero rows and sends no second notice', async () => {
      repo.cancelSession.mockResolvedValue(0);

      const error = await errorOf(service.cancel('student-user', SESSION));

      expect(error.code).toBe('session_not_cancelable');
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });

  describe('setLink', () => {
    it('UT-058 the educator sets the link of one session', async () => {
      await service.setLink('educator-1', SESSION, 'https://meet.test/new');

      expect(repo.setSessionLink).toHaveBeenCalledWith(
        SESSION,
        'https://meet.test/new',
      );
    });

    it('UT-058 an invalid link is refused with 400', async () => {
      const error = await errorOf(
        service.setLink('educator-1', SESSION, 'javascript:alert(1)'),
      );

      expect(error.getStatus()).toBe(400);
      expect(repo.setSessionLink).not.toHaveBeenCalled();
    });

    it('UT-058 a presencial session has no link', async () => {
      repo.findSessionWithParties.mockResolvedValue(
        sessionRow({ type: SessionType.PRESENCIAL }),
      );

      const error = await errorOf(
        service.setLink('educator-1', SESSION, 'https://x.com'),
      );

      expect(error.code).toBe('link_not_allowed');
    });

    it('UT-058 a non-owner gets 404', async () => {
      const error = await errorOf(
        service.setLink('educator-2', SESSION, 'https://x.com'),
      );

      expect(error.getStatus()).toBe(404);
    });
  });

  describe('listUpcomingForActor', () => {
    it('UT-059 labels each fixed session with its counterpart and resolves its letter', async () => {
      repo.findUpcomingFixedForActor.mockResolvedValue([
        sessionRow({ workoutLetter: 'B' }),
      ]);
      workouts.findActiveByClient.mockResolvedValue({
        sessions: [{ name: 'Peito' }, { name: 'Costas' }],
      });

      const asEducator = await service.listUpcomingForActor('educator-1', NOW);
      const asStudent = await service.listUpcomingForActor('student-user', NOW);

      expect(asEducator[0]).toMatchObject({
        source: 'FIXED',
        workoutSessionName: 'Costas',
        counterpart: { id: 'client-1', name: 'Diego' },
      });
      expect(asStudent[0].counterpart).toEqual({
        id: 'educator-1',
        name: 'Thiago',
      });
    });

    it('UT-060 a user with no fixed sessions gets an empty list', async () => {
      await expect(
        service.listUpcomingForActor('student-user', NOW),
      ).resolves.toEqual([]);
    });
  });

  describe('nextForRecords', () => {
    it('UT-061 keeps the earliest of a fixed session and a booking per record, ignoring canceled ones', async () => {
      repo.findScheduledFromForClients.mockResolvedValue([
        sessionRow({
          startAt: new Date('2026-10-12T10:00:00Z'),
          endAt: new Date('2026-10-12T11:00:00Z'),
        }),
      ]);
      repo.findBookedFromForUsers.mockResolvedValue([
        {
          userId: 'student-user',
          startAt: new Date('2026-10-09T10:00:00Z'),
          endAt: new Date('2026-10-09T10:30:00Z'),
          type: SessionType.PRESENCIAL,
          onlineLink: null,
        },
      ]);

      const next = await service.nextForRecords(
        'educator-1',
        [
          { clientId: 'client-1', userId: 'student-user' },
          { clientId: 'client-2', userId: null },
        ],
        NOW,
      );

      expect(next.get('client-1')?.startAt).toEqual(
        new Date('2026-10-09T10:00:00Z'),
      );
      expect(next.has('client-2')).toBe(false);
    });
  });
});
