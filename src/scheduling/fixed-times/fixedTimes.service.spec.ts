import { CodedError } from '@/common/errors/codedError';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { SessionType } from '@prisma/client';
import { Clock } from '../clock.service';
import { FixedTimesService } from './fixedTimes.service';
import { FixedTimeNotificationsService } from './fixedTimeNotifications.service';

const EDUCATOR = 'educator-1';
const STUDENT = '01890a5d-ac96-774b-bcce-b302099a8057';
const OTHER_STUDENT = '01890a5d-ac96-774b-bcce-b302099a8058';
const FIXED = '01890a5d-ac96-774b-bcce-b302099a8099';
// Wednesday 2026-10-07 10:00 UTC (07:00 Brasília), the test "now".
const NOW = new Date('2026-10-07T10:00:00Z');

const client = (overrides: Record<string, unknown> = {}) => ({
  id: STUDENT,
  name: 'Diego',
  professionalId: EDUCATOR,
  userId: 'user-9',
  ...overrides,
});

function ruleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXED,
    clientId: STUDENT,
    professionalId: EDUCATOR,
    weekday: 1,
    startMinute: 7 * 60,
    durationMinutes: 60,
    type: SessionType.PRESENCIAL,
    onlineLink: null,
    workoutLetter: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('FixedTimesService', () => {
  let service: FixedTimesService;
  let clients: { findOwnedById: jest.Mock };
  let repo: Record<string, jest.Mock>;
  let workouts: { findActiveByClient: jest.Mock };
  let notices: { notify: jest.Mock };

  beforeEach(() => {
    clients = { findOwnedById: jest.fn().mockResolvedValue(client()) };
    repo = {
      withEducatorLock: jest.fn(
        (_educator: string, work: (tx: unknown) => unknown) => work({}),
      ),
      findRulesByClient: jest.fn().mockResolvedValue([]),
      findRuleOfClient: jest.fn().mockResolvedValue(ruleRow()),
      countRulesByClient: jest.fn().mockResolvedValue(0),
      createRule: jest.fn((data: object) => ruleRow(data)),
      updateRule: jest.fn((_id: string, data: object) => ruleRow(data)),
      deleteRule: jest.fn().mockResolvedValue(undefined),
      createSessions: jest.fn().mockResolvedValue(0),
      deleteSessions: jest.fn().mockResolvedValue(undefined),
      findFutureSessions: jest.fn().mockResolvedValue([]),
      detachStartedSessions: jest.fn().mockResolvedValue(undefined),
      updateFutureScheduled: jest.fn().mockResolvedValue(undefined),
      findOccupancy: jest.fn().mockResolvedValue([]),
      findClientSessions: jest.fn().mockResolvedValue([]),
      findBookedForUser: jest.fn().mockResolvedValue([]),
    };
    workouts = { findActiveByClient: jest.fn().mockResolvedValue(null) };
    notices = { notify: jest.fn().mockResolvedValue(undefined) };
    const clock = { now: () => NOW } as unknown as Clock;

    service = new FixedTimesService(
      clients as unknown as ClientsRepository,
      repo as unknown as FixedTimesRepository,
      workouts as unknown as EducatorWorkoutsRepository,
      notices as unknown as FixedTimeNotificationsService,
      clock,
    );
  });

  const dto = (overrides: Record<string, unknown> = {}) =>
    ({
      weekday: 1,
      startMinute: 7 * 60,
      type: SessionType.PRESENCIAL,
      ...overrides,
    }) as never;

  async function errorOf(promise: Promise<unknown>): Promise<CodedError> {
    try {
      await promise;
    } catch (error) {
      return error as CodedError;
    }
    throw new Error('expected a rejection');
  }

  describe('list', () => {
    it('UT-020 resolves letters against the active workout and lists the next 28 days in order', async () => {
      repo.findRulesByClient.mockResolvedValue([
        ruleRow({ workoutLetter: 'B' }),
        ruleRow({ id: 'f2', workoutLetter: 'C', weekday: 2 }),
      ]);
      workouts.findActiveByClient.mockResolvedValue({
        id: 'w1',
        title: 'Hipertrofia',
        weeklyFrequency: 3,
        sessions: [
          { id: 's1', name: 'Peito' },
          { id: 's2', name: 'Costas' },
        ],
      });
      repo.findClientSessions.mockResolvedValue([
        {
          id: 'fs2',
          startAt: new Date('2026-10-14T10:00:00Z'),
          endAt: new Date('2026-10-14T11:00:00Z'),
          status: 'CANCELED',
          type: SessionType.PRESENCIAL,
          onlineLink: null,
          workoutLetter: 'B',
        },
        {
          id: 'fs1',
          startAt: new Date('2026-10-12T10:00:00Z'),
          endAt: new Date('2026-10-12T11:00:00Z'),
          status: 'SCHEDULED',
          type: SessionType.PRESENCIAL,
          onlineLink: null,
          workoutLetter: 'B',
        },
      ]);
      repo.findBookedForUser.mockResolvedValue([
        {
          id: 'b1',
          startAt: new Date('2026-10-13T10:00:00Z'),
          endAt: new Date('2026-10-13T10:30:00Z'),
          type: SessionType.ONLINE,
          onlineLink: 'https://x.com/a',
        },
      ]);

      const result = await service.list(EDUCATOR, STUDENT);

      expect(result.fixedTimes[0]).toMatchObject({
        workoutSessionName: 'Costas',
        workoutMissing: false,
      });
      expect(result.fixedTimes[1]).toMatchObject({
        workoutSessionName: null,
        workoutMissing: true,
      });
      expect(
        result.upcoming.map((item) => [item.id, item.source, item.status]),
      ).toEqual([
        ['fs1', 'FIXED', 'SCHEDULED'],
        ['b1', 'BOOKING', 'BOOKED'],
        ['fs2', 'FIXED', 'CANCELED'],
      ]);
    });

    it('UT-021 returns no fixed times for a student with none', async () => {
      const result = await service.list(EDUCATOR, STUDENT);

      expect(result).toEqual({ fixedTimes: [], upcoming: [] });
    });

    it('UT-022 answers a foreign or missing student with 404 student_not_found', async () => {
      clients.findOwnedById.mockResolvedValue(null);

      const error = await errorOf(service.list(EDUCATOR, STUDENT));

      expect(error.getStatus()).toBe(404);
      expect(error.code).toBe('student_not_found');
    });

    it('answers a malformed student id with the same 404 without querying', async () => {
      const error = await errorOf(service.list(EDUCATOR, 'not-a-uuid'));

      expect(error.code).toBe('student_not_found');
      expect(clients.findOwnedById).not.toHaveBeenCalled();
    });

    it('UT-048 lists no fixed times after the last one is removed', async () => {
      repo.findRulesByClient.mockResolvedValue([]);

      const result = await service.list(EDUCATOR, STUDENT);

      expect(result.fixedTimes).toEqual([]);
    });
  });

  describe('create', () => {
    it('UT-023 persists the rule and one session per occurrence of the next 35 days', async () => {
      const result = await service.create(
        EDUCATOR,
        STUDENT,
        dto({ workoutLetter: 'A' }),
      );

      expect(result).toMatchObject({
        weekday: 1,
        startMinute: 420,
        durationMinutes: 60,
        workoutLetter: 'A',
      });
      const rows = repo.createSessions.mock.calls[0][0];
      expect(rows).toHaveLength(5);
      expect(rows[0].startAt.toISOString()).toBe('2026-10-12T10:00:00.000Z');
      expect(rows[0].endAt.toISOString()).toBe('2026-10-12T11:00:00.000Z');
    });

    it('UT-024 includes today when the start has not passed, and skips it once it has', async () => {
      const early = new Date('2026-10-12T09:30:00Z');
      repo.createSessions.mockClear();
      service = new FixedTimesService(
        clients as unknown as ClientsRepository,
        repo as unknown as FixedTimesRepository,
        workouts as unknown as EducatorWorkoutsRepository,
        notices as unknown as FixedTimeNotificationsService,
        { now: () => new Date('2026-10-12T09:30:00Z') } as Clock,
      );
      await service.create(EDUCATOR, STUDENT, dto());
      expect(
        repo.createSessions.mock.calls[0][0][0].startAt.toISOString(),
      ).toBe(early.toISOString().slice(0, 10) + 'T10:00:00.000Z');

      repo.createSessions.mockClear();
      service = new FixedTimesService(
        clients as unknown as ClientsRepository,
        repo as unknown as FixedTimesRepository,
        workouts as unknown as EducatorWorkoutsRepository,
        notices as unknown as FixedTimeNotificationsService,
        { now: () => new Date('2026-10-12T10:30:00Z') } as Clock,
      );
      await service.create(EDUCATOR, STUDENT, dto());
      expect(
        repo.createSessions.mock.calls[0][0][0].startAt.toISOString(),
      ).toBe('2026-10-19T10:00:00.000Z');
    });

    it('UT-025 accepts the 14th time and refuses the 15th with fixed_time_limit', async () => {
      repo.countRulesByClient.mockResolvedValueOnce(13);
      await expect(
        service.create(EDUCATOR, STUDENT, dto()),
      ).resolves.toBeDefined();

      repo.countRulesByClient.mockResolvedValueOnce(14);
      const error = await errorOf(service.create(EDUCATOR, STUDENT, dto()));
      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('fixed_time_limit');
    });

    it('UT-026 refuses an overlap with another student’s fixed session and creates nothing', async () => {
      repo.findOccupancy.mockResolvedValue([
        {
          startAt: new Date('2026-10-12T10:30:00Z'),
          endAt: new Date('2026-10-12T11:30:00Z'),
          status: 'SCHEDULED',
          fixedTimeId: 'other',
          studentName: 'Bruna',
        },
      ]);

      const error = await errorOf(service.create(EDUCATOR, STUDENT, dto()));

      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('schedule_conflict');
      expect(error.getResponse()).toMatchObject({
        details: {
          studentName: 'Bruna',
          startAt: new Date('2026-10-12T10:30:00Z'),
          endAt: new Date('2026-10-12T11:30:00Z'),
        },
      });
      expect(repo.createRule).not.toHaveBeenCalled();
      expect(repo.createSessions).not.toHaveBeenCalled();
    });

    it('UT-027 refuses an overlap with a booked session and names its student', async () => {
      repo.findOccupancy.mockResolvedValue([
        {
          startAt: new Date('2026-10-12T10:00:00Z'),
          endAt: new Date('2026-10-12T11:00:00Z'),
          status: 'BOOKED',
          fixedTimeId: null,
          studentName: 'Ana',
        },
      ]);

      const error = await errorOf(service.create(EDUCATOR, STUDENT, dto()));

      expect(error.code).toBe('schedule_conflict');
      expect(error.getResponse()).toMatchObject({
        details: { studentName: 'Ana' },
      });
    });

    it('UT-028 allows touching a session and overlapping only a canceled one', async () => {
      repo.findOccupancy.mockResolvedValue([
        {
          startAt: new Date('2026-10-12T09:00:00Z'),
          endAt: new Date('2026-10-12T10:00:00Z'),
          status: 'SCHEDULED',
          fixedTimeId: 'other',
          studentName: 'Bruna',
        },
        {
          startAt: new Date('2026-10-12T10:00:00Z'),
          endAt: new Date('2026-10-12T11:00:00Z'),
          status: 'CANCELED',
          fixedTimeId: 'other',
          studentName: 'Ana',
        },
      ]);

      await expect(
        service.create(EDUCATOR, STUDENT, dto()),
      ).resolves.toBeDefined();
    });

    it('UT-029 refuses a conflict that only falls in the fourth week', async () => {
      repo.findOccupancy.mockResolvedValue([
        {
          startAt: new Date('2026-11-02T10:00:00Z'),
          endAt: new Date('2026-11-02T11:00:00Z'),
          status: 'SCHEDULED',
          fixedTimeId: 'other',
          studentName: 'Bruna',
        },
      ]);

      const error = await errorOf(service.create(EDUCATOR, STUDENT, dto()));

      expect(error.code).toBe('schedule_conflict');
    });

    it('UT-030 runs the conflict check and the inserts inside the educator lock', async () => {
      let inside = false;
      repo.withEducatorLock.mockImplementation(
        async (educatorId: string, work: (tx: unknown) => Promise<unknown>) => {
          expect(educatorId).toBe(EDUCATOR);
          inside = true;
          try {
            return await work({});
          } finally {
            inside = false;
          }
        },
      );
      repo.findOccupancy.mockImplementation(() => {
        expect(inside).toBe(true);
        return [];
      });
      repo.createSessions.mockImplementation(() => {
        expect(inside).toBe(true);
        return 5;
      });

      await service.create(EDUCATOR, STUDENT, dto());

      expect(repo.withEducatorLock).toHaveBeenCalledTimes(1);
    });

    it('UT-031 refuses an invalid value with 400 and creates nothing', async () => {
      const error = await errorOf(
        service.create(EDUCATOR, STUDENT, dto({ startMinute: 423 })),
      );

      expect(error.getStatus()).toBe(400);
      expect(error.code).toBe('fixed_time_invalid');
      expect(repo.createRule).not.toHaveBeenCalled();
    });

    it('UT-004 refuses a link on a presencial time with link_not_allowed', async () => {
      const error = await errorOf(
        service.create(EDUCATOR, STUDENT, dto({ onlineLink: 'https://x.com' })),
      );

      expect(error.code).toBe('link_not_allowed');
    });

    it('UT-032 notifies the student once after the commit', async () => {
      await service.create(EDUCATOR, STUDENT, dto());

      expect(notices.notify).toHaveBeenCalledTimes(1);
      expect(notices.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-9', kind: 'created' }),
      );
    });

    it('UT-034 answers a foreign student with 404 and notifies nobody', async () => {
      clients.findOwnedById.mockResolvedValue(null);

      const error = await errorOf(
        service.create(EDUCATOR, OTHER_STUDENT, dto()),
      );

      expect(error.code).toBe('student_not_found');
      expect(repo.withEducatorLock).not.toHaveBeenCalled();
      expect(notices.notify).not.toHaveBeenCalled();
    });

    it('UT-035 refuses a second identical time against the first', async () => {
      repo.findOccupancy.mockResolvedValue([
        {
          startAt: new Date('2026-10-12T10:00:00Z'),
          endAt: new Date('2026-10-12T11:00:00Z'),
          status: 'SCHEDULED',
          fixedTimeId: FIXED,
          studentName: 'Diego',
        },
      ]);

      const error = await errorOf(service.create(EDUCATOR, STUDENT, dto()));

      expect(error.code).toBe('schedule_conflict');
    });
  });

  describe('update', () => {
    it('UT-036 regenerates the future sessions when the start changes and keeps a canceled date canceled', async () => {
      repo.findFutureSessions.mockResolvedValue([
        {
          id: 'sched-1',
          startAt: new Date('2026-10-12T10:00:00Z'),
          status: 'SCHEDULED',
        },
        {
          id: 'canc-1',
          startAt: new Date('2026-10-19T10:00:00Z'),
          status: 'CANCELED',
        },
      ]);

      const result = await service.update(EDUCATOR, STUDENT, FIXED, {
        startMinute: 8 * 60,
      } as never);

      expect(result.startMinute).toBe(480);
      const deleted = repo.deleteSessions.mock.calls[0][0] as string[];
      expect(deleted).toContain('sched-1');
      expect(deleted).not.toContain('canc-1');
      const created = repo.createSessions.mock.calls[0][0] as Array<{
        startAt: Date;
      }>;
      expect(created.map((row) => row.startAt.toISOString())).not.toContain(
        '2026-10-19T11:00:00.000Z',
      );
      expect(created[0].startAt.toISOString()).toBe('2026-10-12T11:00:00.000Z');
    });

    it('UT-036 drops a canceled marker that is no longer an occurrence of the new rule', async () => {
      repo.findFutureSessions.mockResolvedValue([
        {
          id: 'canc-tue',
          startAt: new Date('2026-10-13T10:00:00Z'),
          status: 'CANCELED',
        },
      ]);

      await service.update(EDUCATOR, STUDENT, FIXED, {
        startMinute: 8 * 60,
      } as never);

      expect(repo.deleteSessions.mock.calls[0][0]).toEqual(['canc-tue']);
    });

    it('UT-037 updates type, link and letter of future sessions in place', async () => {
      repo.findRuleOfClient.mockResolvedValue(
        ruleRow({ type: SessionType.ONLINE, onlineLink: 'https://x.com/old' }),
      );

      await service.update(EDUCATOR, STUDENT, FIXED, {
        onlineLink: 'https://x.com/new',
        workoutLetter: 'B',
      } as never);

      expect(repo.deleteSessions).not.toHaveBeenCalled();
      expect(repo.createSessions).not.toHaveBeenCalled();
      expect(repo.updateFutureScheduled).toHaveBeenCalledWith(
        FIXED,
        NOW,
        expect.objectContaining({ workoutLetter: 'B' }),
        {},
        expect.anything(),
      );
      expect(repo.updateFutureScheduled).toHaveBeenCalledWith(
        FIXED,
        NOW,
        { onlineLink: 'https://x.com/new' },
        { onlineLink: 'https://x.com/old' },
        expect.anything(),
      );
    });

    it('UT-038 refuses an overlap with another session and changes nothing', async () => {
      repo.findOccupancy.mockResolvedValue([
        {
          startAt: new Date('2026-10-12T11:00:00Z'),
          endAt: new Date('2026-10-12T12:00:00Z'),
          status: 'SCHEDULED',
          fixedTimeId: 'other',
          studentName: 'Bruna',
        },
      ]);

      const error = await errorOf(
        service.update(EDUCATOR, STUDENT, FIXED, {
          startMinute: 8 * 60,
        } as never),
      );

      expect(error.code).toBe('schedule_conflict');
      expect(repo.updateRule).not.toHaveBeenCalled();
      expect(notices.notify).not.toHaveBeenCalled();
    });

    it('UT-038 does not treat the fixed time’s own sessions as a conflict', async () => {
      repo.findRuleOfClient.mockResolvedValue(ruleRow());
      repo.findOccupancy.mockResolvedValue([
        {
          startAt: new Date('2026-10-12T11:00:00Z'),
          endAt: new Date('2026-10-12T12:00:00Z'),
          status: 'SCHEDULED',
          fixedTimeId: FIXED,
          studentName: 'Diego',
        },
      ]);

      await expect(
        service.update(EDUCATOR, STUDENT, FIXED, {
          startMinute: 8 * 60,
        } as never),
      ).resolves.toBeDefined();
    });

    it('UT-039 writes nothing and notifies nobody when the values are identical', async () => {
      const result = await service.update(EDUCATOR, STUDENT, FIXED, {
        startMinute: 7 * 60,
      } as never);

      expect(result.startMinute).toBe(420);
      expect(repo.updateRule).not.toHaveBeenCalled();
      expect(repo.updateFutureScheduled).not.toHaveBeenCalled();
      expect(notices.notify).not.toHaveBeenCalled();
    });

    it('UT-040 notifies the student once when a value really changes', async () => {
      await service.update(EDUCATOR, STUDENT, FIXED, {
        durationMinutes: 90,
      } as never);

      expect(notices.notify).toHaveBeenCalledTimes(1);
      expect(notices.notify).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'changed', userId: 'user-9' }),
      );
    });

    it('UT-041 refuses an invalid value and leaves the stored time unchanged', async () => {
      const error = await errorOf(
        service.update(EDUCATOR, STUDENT, FIXED, {
          durationMinutes: 245,
        } as never),
      );

      expect(error.code).toBe('fixed_time_invalid');
      expect(repo.updateRule).not.toHaveBeenCalled();
    });

    it('UT-042 answers a missing or removed fixed time with 404 fixed_time_not_found', async () => {
      repo.findRuleOfClient.mockResolvedValue(null);

      const error = await errorOf(
        service.update(EDUCATOR, STUDENT, FIXED, { weekday: 2 } as never),
      );

      expect(error.getStatus()).toBe(404);
      expect(error.code).toBe('fixed_time_not_found');
    });

    it('UT-043 never alters sessions that have started (only future ones are read)', async () => {
      await service.update(EDUCATOR, STUDENT, FIXED, {
        startMinute: 8 * 60,
      } as never);

      expect(repo.findFutureSessions).toHaveBeenCalledWith(
        FIXED,
        NOW,
        expect.anything(),
      );
    });

    it('turns a presencial change into a removal of the link', async () => {
      repo.findRuleOfClient.mockResolvedValue(
        ruleRow({ type: SessionType.ONLINE, onlineLink: 'https://x.com/a' }),
      );

      await service.update(EDUCATOR, STUDENT, FIXED, {
        type: SessionType.PRESENCIAL,
      } as never);

      expect(repo.updateRule).toHaveBeenCalledWith(
        FIXED,
        expect.objectContaining({
          type: SessionType.PRESENCIAL,
          onlineLink: null,
        }),
        expect.anything(),
      );
    });
  });

  describe('remove', () => {
    it('UT-044 deletes future sessions, detaches started ones, deletes the rule and notifies once', async () => {
      repo.findFutureSessions.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      await service.remove(EDUCATOR, STUDENT, FIXED);

      expect(repo.deleteSessions).toHaveBeenCalledWith(
        ['a', 'b'],
        expect.anything(),
      );
      expect(repo.detachStartedSessions).toHaveBeenCalledWith(
        FIXED,
        NOW,
        expect.anything(),
      );
      expect(repo.deleteRule).toHaveBeenCalledWith(FIXED, expect.anything());
      expect(notices.notify).toHaveBeenCalledTimes(1);
      expect(notices.notify).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'removed' }),
      );
    });

    it('UT-045 answers a second removal with 404 and changes nothing', async () => {
      repo.findRuleOfClient.mockResolvedValue(null);

      const error = await errorOf(service.remove(EDUCATOR, STUDENT, FIXED));

      expect(error.code).toBe('fixed_time_not_found');
      expect(repo.deleteRule).not.toHaveBeenCalled();
      expect(notices.notify).not.toHaveBeenCalled();
    });

    it('UT-046 lets a failing step propagate and sends no notice', async () => {
      repo.deleteRule.mockRejectedValue(new Error('db down'));

      await expect(service.remove(EDUCATOR, STUDENT, FIXED)).rejects.toThrow(
        'db down',
      );
      expect(notices.notify).not.toHaveBeenCalled();
    });

    it('UT-047 sends no notice for a record without an account', async () => {
      clients.findOwnedById.mockResolvedValue(client({ userId: null }));

      await service.remove(EDUCATOR, STUDENT, FIXED);

      expect(notices.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: null }),
      );
    });

    it('UT-057 deletes a canceled marker along with the scheduled ones, without a second notice', async () => {
      repo.findFutureSessions.mockResolvedValue([
        { id: 'scheduled', status: 'SCHEDULED' },
        { id: 'canceled', status: 'CANCELED' },
      ]);

      await service.remove(EDUCATOR, STUDENT, FIXED);

      expect(repo.deleteSessions).toHaveBeenCalledWith(
        ['scheduled', 'canceled'],
        expect.anything(),
      );
      expect(notices.notify).toHaveBeenCalledTimes(1);
    });
  });
});
