import { Clock } from '@/scheduling/clock.service';
import { FixedSessionsService } from '@/scheduling/fixed-times/fixedSessions.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { ProfessionalDiscoveryService } from '@/professional-discovery/professionalDiscovery.service';
import { SessionType } from '@prisma/client';
import { ProfessionalMirrorService } from './professionalMirror.service';

const NOW = new Date('2026-10-07T10:00:00Z');

describe('ProfessionalMirrorService schedule (UT-080 to UT-082)', () => {
  let service: ProfessionalMirrorService;
  let next: Map<string, unknown>;
  let todaySessionId: jest.Mock;
  let active: {
    id: string;
    title: string;
    weeklyFrequency: number | null;
    sessions: Array<{
      id: string;
      name: string;
      _count: { exercises: number };
    }>;
  } | null;

  beforeEach(() => {
    next = new Map();
    todaySessionId = jest.fn().mockResolvedValue(null);
    active = null;
    const clients = {
      findByUserAndProfessionalType: jest.fn().mockResolvedValue({
        id: 'client-1',
        userId: 'student-user',
        professionalId: 'educator-1',
      }),
    };
    const discovery = {
      getProfile: jest.fn().mockResolvedValue({
        id: 'educator-1',
        name: 'Thiago',
        specialty: null,
      }),
    };
    const assessments = { findLatestByClient: jest.fn().mockResolvedValue([]) };
    const workouts = { findActiveByClient: jest.fn(() => active) };
    service = new ProfessionalMirrorService(
      clients as unknown as ClientsRepository,
      discovery as unknown as ProfessionalDiscoveryService,
      assessments as unknown as PhysicalAssessmentsRepository,
      workouts as unknown as EducatorWorkoutsRepository,
      {
        nextForRecords: jest.fn(() => next),
        todaySessionId,
      } as unknown as FixedSessionsService,
      { now: () => NOW } as Clock,
    );
  });

  it('UT-080 returns the next session with its link, letter and session name; null when none', async () => {
    active = {
      id: 'w1',
      title: 'Hipertrofia',
      weeklyFrequency: 3,
      sessions: [
        { id: 's1', name: 'Peito', _count: { exercises: 4 } },
        { id: 's2', name: 'Costas', _count: { exercises: 3 } },
      ],
    };
    next.set('client-1', {
      startAt: new Date('2026-10-08T10:00:00Z'),
      endAt: new Date('2026-10-08T11:00:00Z'),
      type: SessionType.ONLINE,
      onlineLink: 'https://meet.test/a',
      workoutLetter: 'B',
    });

    const mirror = (await service.getEducatorMirror('student-user')) as {
      nextSchedule: unknown;
    };

    expect(mirror.nextSchedule).toEqual({
      startAt: new Date('2026-10-08T10:00:00Z'),
      endAt: new Date('2026-10-08T11:00:00Z'),
      type: SessionType.ONLINE,
      onlineLink: 'https://meet.test/a',
      workoutLetter: 'B',
      workoutSessionName: 'Costas',
    });

    next.clear();
    const none = (await service.getEducatorMirror('student-user')) as {
      nextSchedule: unknown;
    };
    expect(none.nextSchedule).toBeNull();
  });

  it('UT-081 a booked session has the same shape, with no letter', async () => {
    next.set('client-1', {
      startAt: new Date('2026-10-08T10:00:00Z'),
      endAt: new Date('2026-10-08T11:00:00Z'),
      type: SessionType.PRESENCIAL,
      onlineLink: null,
      workoutLetter: null,
    });

    const mirror = (await service.getEducatorMirror('student-user')) as {
      nextSchedule: { workoutSessionName: unknown; workoutLetter: unknown };
    };

    expect(mirror.nextSchedule.workoutLetter).toBeNull();
    expect(mirror.nextSchedule.workoutSessionName).toBeNull();
  });

  it('UT-082 today’s workout carries the id of today’s resolved session', async () => {
    active = {
      id: 'w1',
      title: 'Hipertrofia',
      weeklyFrequency: null,
      sessions: [{ id: 's1', name: 'Peito', _count: { exercises: 1 } }],
    };
    todaySessionId.mockResolvedValue('fixed-session-9');

    const mirror = (await service.getEducatorMirror('student-user')) as {
      todayWorkout: { todaySessionId: string | null };
    };

    expect(mirror.todayWorkout.todaySessionId).toBe('fixed-session-9');
    expect(todaySessionId).toHaveBeenCalledWith('client-1', NOW);
  });
});
