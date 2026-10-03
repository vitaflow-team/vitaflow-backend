import { PrismaService } from '@/database/prisma.service';
import { EducatorWorkoutsRepository } from './educatorWorkouts.repository';

function makeTx() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    educatorWorkout: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'w1', sessions: [] }),
    },
    educatorWorkoutSession: {
      update: jest.fn().mockResolvedValue({}),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: `new-session-${data.position}`, ...data }),
        ),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    educatorWorkoutExercise: {
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: `new-exercise-${data.sessionId}-${data.position}`,
          ...data,
        }),
      ),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

const item = (overrides: object = {}) => ({
  source: 'FREE' as const,
  exerciseId: null,
  name: 'Prancha',
  muscleGroup: 'Abdômen',
  equipment: null,
  sets: 3,
  reps: '30s',
  load: null,
  videoUrl: null,
  ...overrides,
});

describe('EducatorWorkoutsRepository', () => {
  const prisma = {
    $transaction: jest.fn(),
    educatorWorkout: { updateMany: jest.fn() },
  };
  let repository: EducatorWorkoutsRepository;
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    jest.resetAllMocks();
    tx = makeTx();
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: unknown) => unknown)(tx)
        : Promise.resolve(arg),
    );
    repository = new EducatorWorkoutsRepository(
      prisma as unknown as PrismaService,
    );
  });

  describe('applyTree', () => {
    it('UT-075 runs one transaction: creates, updates, deletes and rewrites positions', async () => {
      await repository.applyTree('w1', {
        title: 'Novo título',
        weeklyFrequency: 3,
        sessions: [
          {
            id: 's2',
            name: 'Costas',
            exercises: [item({ id: 'e5' }), item({ name: 'Nova' })],
          },
          { name: 'Sessão nova', exercises: [item()] },
        ],
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.educatorWorkout.update).toHaveBeenCalledWith({
        where: { id: 'w1' },
        data: { title: 'Novo título', weeklyFrequency: 3 },
      });
      expect(tx.educatorWorkoutSession.update).toHaveBeenCalledWith({
        where: { id: 's2', workoutId: 'w1' },
        data: { name: 'Costas', position: 0 },
      });
      expect(tx.educatorWorkoutSession.create).toHaveBeenCalledWith({
        data: { workoutId: 'w1', name: 'Sessão nova', position: 1 },
      });
      expect(tx.educatorWorkoutExercise.update).toHaveBeenCalledWith({
        where: { id: 'e5', session: { workoutId: 'w1' } },
        data: expect.objectContaining({ sessionId: 's2', position: 0 }),
      });
      expect(tx.educatorWorkoutExercise.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sessionId: 's2',
          position: 1,
          name: 'Nova',
        }),
      });
    });

    it('UT-075 deletes this workout items missing from the request, exercises before sessions', async () => {
      const order: string[] = [];
      tx.educatorWorkoutExercise.deleteMany.mockImplementation(() => {
        order.push('exercises');
        return Promise.resolve({ count: 1 });
      });
      tx.educatorWorkoutSession.deleteMany.mockImplementation(() => {
        order.push('sessions');
        return Promise.resolve({ count: 1 });
      });

      await repository.applyTree('w1', {
        title: 'T',
        weeklyFrequency: null,
        sessions: [{ id: 's1', name: 'A', exercises: [item({ id: 'e1' })] }],
      });

      expect(order).toEqual(['exercises', 'sessions']);
      expect(tx.educatorWorkoutExercise.deleteMany).toHaveBeenCalledWith({
        where: { session: { workoutId: 'w1' }, id: { notIn: ['e1'] } },
      });
      expect(tx.educatorWorkoutSession.deleteMany).toHaveBeenCalledWith({
        where: { workoutId: 'w1', id: { notIn: ['s1'] } },
      });
    });
  });

  describe('activate', () => {
    it('UT-077 locks the student record row before archiving and activating, in one transaction', async () => {
      const order: string[] = [];
      tx.$queryRaw.mockImplementation(() => {
        order.push('lock');
        return Promise.resolve([]);
      });
      tx.educatorWorkout.findFirst.mockResolvedValue({ status: 'DRAFT' });
      tx.educatorWorkout.updateMany.mockImplementation(() => {
        order.push('archive');
        return Promise.resolve({ count: 1 });
      });
      tx.educatorWorkout.update.mockImplementation(() => {
        order.push('activate');
        return Promise.resolve({});
      });

      const changed = await repository.activate('c1', 'w2');

      expect(changed).toBe(true);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['lock', 'archive', 'activate']);
      expect(tx.educatorWorkout.updateMany).toHaveBeenCalledWith({
        where: { clientId: 'c1', status: 'ACTIVE', id: { not: 'w2' } },
        data: { status: 'ARCHIVED' },
      });
    });

    it('writes nothing when the workout is already active or missing', async () => {
      tx.educatorWorkout.findFirst.mockResolvedValueOnce({ status: 'ACTIVE' });
      expect(await repository.activate('c1', 'w1')).toBe(false);

      tx.educatorWorkout.findFirst.mockResolvedValueOnce(null);
      expect(await repository.activate('c1', 'gone')).toBe(false);

      expect(tx.educatorWorkout.updateMany).not.toHaveBeenCalled();
      expect(tx.educatorWorkout.update).not.toHaveBeenCalled();
    });
  });

  describe('claimEditNotification', () => {
    const NOW = new Date('2026-10-04T12:00:00.000Z');

    it('UT-076 issues one conditional update limited to id, ACTIVE and an old or absent window', async () => {
      prisma.educatorWorkout.updateMany.mockResolvedValue({ count: 1 });

      const claimed = await repository.claimEditNotification('w1', NOW, 30);

      expect(claimed).toBe(true);
      expect(prisma.educatorWorkout.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.educatorWorkout.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'w1',
          status: 'ACTIVE',
          OR: [
            { lastEditNotifiedAt: null },
            {
              lastEditNotifiedAt: { lt: new Date('2026-10-04T11:30:00.000Z') },
            },
          ],
        },
        data: { lastEditNotifiedAt: NOW },
      });
    });

    it('UT-076 returns false when no row changed', async () => {
      prisma.educatorWorkout.updateMany.mockResolvedValue({ count: 0 });

      expect(await repository.claimEditNotification('w1', NOW, 30)).toBe(false);
    });

    it('UT-056 puts the window edge exactly 30 minutes before now', async () => {
      prisma.educatorWorkout.updateMany.mockResolvedValue({ count: 0 });

      await repository.claimEditNotification('w1', NOW, 30);

      const { where } = prisma.educatorWorkout.updateMany.mock.calls[0][0];
      const edge = where.OR[1].lastEditNotifiedAt.lt as Date;
      const twentyNineFiftyNine = new Date(
        NOW.getTime() - (30 * 60_000 - 1_000),
      );
      const thirtyOne = new Date(NOW.getTime() - (30 * 60_000 + 1_000));
      expect(twentyNineFiftyNine < edge).toBe(false);
      expect(thirtyOne < edge).toBe(true);
    });
  });

  describe('deactivate', () => {
    it('archives only an active workout and reports whether it changed', async () => {
      prisma.educatorWorkout.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.educatorWorkout.updateMany.mockResolvedValueOnce({ count: 0 });

      expect(await repository.deactivate('w1')).toBe(true);
      expect(await repository.deactivate('w1')).toBe(false);
      expect(prisma.educatorWorkout.updateMany).toHaveBeenCalledWith({
        where: { id: 'w1', status: 'ACTIVE' },
        data: { status: 'ARCHIVED' },
      });
    });
  });
});
