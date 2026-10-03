import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { StudentWorkoutsController } from './studentWorkouts.controller';
import { StudentWorkoutsService } from './studentWorkouts.service';
import { WorkoutsController } from './workouts.controller';

const NOW = new Date('2026-10-04T12:00:00.000Z');

function row(overrides: object = {}) {
  return {
    id: 'w1',
    clientId: 'c1',
    title: 'Hipertrofia',
    weeklyFrequency: 4,
    status: 'ACTIVE',
    lastEditNotifiedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    client: { professional: { id: 'edu-1', name: 'Thiago Ramos' } },
    sessions: [
      {
        id: 's1',
        name: 'Peito',
        position: 0,
        exercises: [
          {
            id: 'e1',
            name: 'Supino',
            muscleGroup: 'Peito',
            sets: 3,
            reps: '8-12',
            load: '40 kg',
            videoUrl: null,
            exercise: {
              videoUrl: 'https://lib/v',
              contraindications: ['KNEE'],
            },
          },
          {
            id: 'e2',
            name: 'Prancha',
            muscleGroup: 'Abdômen',
            sets: 3,
            reps: '30s',
            load: null,
            videoUrl: 'https://youtu.be/x',
            exercise: null,
          },
          {
            id: 'e3',
            name: 'Flexão',
            muscleGroup: 'Peito',
            sets: 3,
            reps: '10',
            load: null,
            videoUrl: null,
            exercise: null,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];
}

describe('StudentWorkoutsService', () => {
  const findActiveByLinkedUser = jest.fn();
  let service: StudentWorkoutsService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new StudentWorkoutsService(
      {
        findActiveByLinkedUser,
      } as unknown as EducatorWorkoutsRepository,
      { todaySessionId: jest.fn().mockResolvedValue(null) } as any,
      { now: () => new Date('2026-10-01T12:00:00Z') } as any,
    );
  });

  it('UT-062 returns the educator, the effective video and nothing educator-only', async () => {
    findActiveByLinkedUser.mockResolvedValue([row()]);

    const result = await service.getActiveForUser('user-1');

    expect(findActiveByLinkedUser).toHaveBeenCalledWith('user-1');
    const [entry] = result.workouts;
    expect(entry.educator).toEqual({ id: 'edu-1', name: 'Thiago Ramos' });
    expect(entry.workout.sessions[0]).toMatchObject({
      label: 'A',
      name: 'Peito',
    });
    expect(entry.workout.sessions[0].exercises.map((e) => e.videoUrl)).toEqual([
      'https://lib/v',
      'https://youtu.be/x',
      null,
    ]);
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'status',
      'conflicts',
      'contraindications',
      'lastEditNotifiedAt',
      'clientId',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('UT-063 returns one entry per linked educator', async () => {
    findActiveByLinkedUser.mockResolvedValue([
      row(),
      row({
        id: 'w2',
        client: { professional: { id: 'edu-2', name: 'Marina Costa' } },
      }),
    ]);

    const result = await service.getActiveForUser('user-1');

    expect(result.workouts.map((w) => w.educator.name)).toEqual([
      'Thiago Ramos',
      'Marina Costa',
    ]);
  });

  it('UT-064 and UT-065 return an empty list when nothing is linked or active', async () => {
    findActiveByLinkedUser.mockResolvedValue([]);

    expect(await service.getActiveForUser('user-1')).toEqual({ workouts: [] });
  });
});

describe('workout controllers', () => {
  it('UT-072 declares every educator route under AuthGuard then PhysicalEducatorGuard', () => {
    expect(guardsOf(WorkoutsController)).toEqual([
      AuthGuard,
      PhysicalEducatorGuard,
    ]);
  });

  it('UT-131 declares the student read under AuthGuard only', () => {
    expect(guardsOf(StudentWorkoutsController)).toEqual([AuthGuard]);
  });

  it('UT-131 reads only the caller own workouts', async () => {
    const service = {
      getActiveForUser: jest.fn().mockResolvedValue({ workouts: [] }),
    };
    const controller = new StudentWorkoutsController(
      service as unknown as StudentWorkoutsService,
    );

    await controller.getActive({ user: { id: 'me' } } as never);

    expect(service.getActiveForUser).toHaveBeenCalledWith('me');
  });
});
