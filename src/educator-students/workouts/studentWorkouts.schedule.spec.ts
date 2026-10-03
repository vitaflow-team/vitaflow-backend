import { Clock } from '@/scheduling/clock.service';
import { FixedSessionsService } from '@/scheduling/fixed-times/fixedSessions.service';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { StudentWorkoutsService } from './studentWorkouts.service';

const NOW = new Date('2026-10-07T10:00:00Z');

function row(id: string, clientId: string) {
  return {
    id,
    clientId,
    title: 'Hipertrofia',
    weeklyFrequency: 3,
    updatedAt: NOW,
    client: { professional: { id: 'educator-1', name: 'Thiago' } },
    sessions: [],
  };
}

describe('StudentWorkoutsService today’s session (UT-083)', () => {
  it('carries today’s session id per workout, null when none resolves', async () => {
    const todaySessionId = jest.fn((clientId: string) =>
      clientId === 'client-1' ? 'session-today' : null,
    );
    const service = new StudentWorkoutsService(
      {
        findActiveByLinkedUser: jest
          .fn()
          .mockResolvedValue([row('w1', 'client-1'), row('w2', 'client-2')]),
      } as unknown as EducatorWorkoutsRepository,
      { todaySessionId } as unknown as FixedSessionsService,
      { now: () => NOW } as Clock,
    );

    const result = await service.getActiveForUser('student-user');

    expect(result.workouts.map((item) => item.todaySessionId)).toEqual([
      'session-today',
      null,
    ]);
    expect(todaySessionId).toHaveBeenCalledWith('client-1', NOW);
  });
});
