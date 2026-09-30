import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkoutInput, WorkoutsRepository } from './workouts.repository';

describe('WorkoutsRepository', () => {
  const findFirst = jest.fn();
  const count = jest.fn();
  const create = jest.fn();
  const deleteMany = jest.fn();
  const transaction = jest.fn((operations: Promise<unknown>[]) =>
    Promise.all(operations),
  );
  const exerciseFindUnique = jest.fn();
  const exerciseUpdate = jest.fn();
  const exerciseDelete = jest.fn();
  let repository: WorkoutsRepository;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutsRepository,
        {
          provide: PrismaService,
          useValue: {
            $transaction: transaction,
            workout: { findFirst, count, create, deleteMany },
            workoutExercise: {
              findUnique: exerciseFindUnique,
              update: exerciseUpdate,
              delete: exerciseDelete,
            },
          },
        },
      ],
    }).compile();
    repository = module.get(WorkoutsRepository);
  });

  it('finds the most recent workout for a user with its nested days/exercises', async () => {
    const workout = { id: 'workout-1', userId: 'user-1', days: [] };
    findFirst.mockResolvedValue(workout);

    const result = await repository.findCurrentByUserId('user-1');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(result).toBe(workout);
  });

  it('reports existsForUser as false when the user has no workout', async () => {
    count.mockResolvedValue(0);

    await expect(repository.existsForUser('user-1')).resolves.toBe(false);
  });

  it('reports existsForUser as true when a workout row exists', async () => {
    count.mockResolvedValue(1);

    await expect(repository.existsForUser('user-1')).resolves.toBe(true);
  });

  it('replaces a prior workout and creates the new one in a single transaction', async () => {
    const input: WorkoutInput = {
      goal: 'MUSCLE_GAIN',
      daysPerWeek: 1,
      explanation: 'Plano gerado.',
      days: [
        {
          dayOfWeek: 1,
          exercises: [
            { exerciseId: 'exercise-1', sets: 3, reps: 10, order: 1 },
          ],
        },
      ],
    };
    const created = { id: 'workout-2', userId: 'user-1', ...input };
    deleteMany.mockResolvedValue({ count: 1 });
    create.mockResolvedValue(created);

    const result = await repository.replace('user-1', input);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          goal: 'MUSCLE_GAIN',
        }),
      }),
    );
    expect(result).toBe(created);
  });

  it('deletes all workouts for a user', async () => {
    await repository.delete('user-1');

    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  });

  it('finds a workout exercise with its day/workout/sibling-count context', async () => {
    const context = {
      id: 'we-1',
      workoutDay: { workout: { userId: 'user-1' }, _count: { exercises: 2 } },
    };
    exerciseFindUnique.mockResolvedValue(context);

    const result = await repository.findExerciseContext('we-1');

    expect(exerciseFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'we-1' } }),
    );
    expect(result).toBe(context);
  });

  it('updates a workout exercise row', async () => {
    await repository.updateExerciseRow('we-1', { sets: 4, reps: 10 });

    expect(exerciseUpdate).toHaveBeenCalledWith({
      where: { id: 'we-1' },
      data: { sets: 4, reps: 10 },
    });
  });

  it('deletes a workout exercise row', async () => {
    await repository.deleteExerciseRow('we-1');

    expect(exerciseDelete).toHaveBeenCalledWith({ where: { id: 'we-1' } });
  });
});
