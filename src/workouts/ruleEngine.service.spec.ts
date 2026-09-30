import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { Test, TestingModule } from '@nestjs/testing';
import { Exercise } from '@prisma/client';
import { RuleEngineService } from './ruleEngine.service';

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  const timestamp = new Date('2026-09-30T09:00:00.000Z');
  return {
    id: `exercise-${Math.random().toString(36).slice(2)}`,
    name: 'Supino reto',
    description: 'Deitado no banco, empurre a barra.',
    muscleGroup: 'Peito',
    primaryMuscles: ['Peito'],
    secondaryMuscles: ['Tríceps'],
    equipment: 'GYM',
    contraindications: [],
    difficulty: null,
    imageUrl: null,
    videoUrl: null,
    status: 'APPROVED',
    sourceAttribution: null,
    sourceLicense: null,
    submittedById: null,
    reviewedById: null,
    rejectionReason: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeCatalog(
  count: number,
  overrides: Partial<Exercise> = {},
): Exercise[] {
  return Array.from({ length: count }, (_, index) =>
    makeExercise({ id: `exercise-${index}`, ...overrides }),
  );
}

describe('RuleEngineService', () => {
  const findMany = jest.fn();
  let service: RuleEngineService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RuleEngineService,
        { provide: ExercisesRepository, useValue: { findMany } },
      ],
    }).compile();
    service = module.get(RuleEngineService);
  });

  it('UT-008 returns 4 days each with exercises, sets and reps when the catalog has enough GYM exercises', async () => {
    findMany.mockResolvedValue(makeCatalog(10, { equipment: 'GYM' }));

    const plan = await service.select({
      goal: 'MUSCLE_GAIN',
      daysPerWeek: 4,
      equipment: 'GYM',
      restrictions: [],
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'APPROVED', equipment: 'GYM' }),
    );
    expect(plan.scaled).toBe(false);
    expect(plan.days).toHaveLength(4);
    for (const day of plan.days) {
      expect(day.exercises.length).toBeGreaterThan(0);
      for (const exercise of day.exercises) {
        expect(exercise.sets).toBeGreaterThan(0);
        expect(exercise.reps).toBeGreaterThan(0);
      }
    }
  });

  it('UT-009 scales the plan down instead of throwing when fewer exercises match than a full plan needs', async () => {
    findMany.mockResolvedValue(makeCatalog(2));

    const plan = await service.select({
      goal: 'MUSCLE_GAIN',
      daysPerWeek: 3,
      equipment: 'GYM',
      restrictions: [],
    });

    expect(plan.scaled).toBe(true);
    for (const day of plan.days) {
      expect(day.exercises.length).toBe(2);
    }
  });

  it("UT-010 returns an empty plan for daysPerWeek 0 instead of throwing (rejection itself is the WorkoutsService/DTO layer's job)", async () => {
    findMany.mockResolvedValue(makeCatalog(10));

    const plan = await service.select({
      goal: 'MUSCLE_GAIN',
      daysPerWeek: 0,
      equipment: 'GYM',
      restrictions: [],
    });

    expect(plan.days).toEqual([]);
    expect(plan.scaled).toBe(false);
  });

  it('UT-011 never returns an exercise contraindicated for an excluded restriction', async () => {
    findMany.mockResolvedValue([
      ...makeCatalog(3, { contraindications: ['SHOULDER'] }),
      ...makeCatalog(5, { contraindications: [] }).map((exercise, index) => ({
        ...exercise,
        id: `safe-${index}`,
      })),
    ]);

    const plan = await service.select({
      goal: 'MUSCLE_GAIN',
      daysPerWeek: 2,
      equipment: 'GYM',
      restrictions: ['SHOULDER'],
    });

    const selectedIds = plan.days.flatMap((day) =>
      day.exercises.map((exercise) => exercise.exerciseId),
    );
    expect(selectedIds.some((id) => id.startsWith('exercise-'))).toBe(false);
    expect(selectedIds.length).toBeGreaterThan(0);
  });

  it('UT-012 still returns a full plan when the restriction matches no exercise in the catalog (coverage gap)', async () => {
    findMany.mockResolvedValue(makeCatalog(10, { contraindications: [] }));

    const plan = await service.select({
      goal: 'MUSCLE_GAIN',
      daysPerWeek: 3,
      equipment: 'GYM',
      restrictions: ['CARDIAC'],
    });

    expect(plan.scaled).toBe(false);
    expect(plan.days).toHaveLength(3);
  });

  it('UT-013 never throws for a severe restriction combination and returns the best plan possible from what remains', async () => {
    findMany.mockResolvedValue([
      ...makeCatalog(8, {
        contraindications: ['SHOULDER', 'KNEE', 'SPINE'],
      }),
      makeExercise({ id: 'last-safe-one', contraindications: [] }),
    ]);

    const plan = await service.select({
      goal: 'MUSCLE_GAIN',
      daysPerWeek: 3,
      equipment: 'GYM',
      restrictions: ['SHOULDER', 'KNEE', 'SPINE'],
    });

    expect(plan.scaled).toBe(true);
    for (const day of plan.days) {
      expect(day.exercises).toEqual([
        expect.objectContaining({ exerciseId: 'last-safe-one' }),
      ]);
    }
  });

  it('never returns an exercise whose status is not APPROVED (delegated to the repository filter)', async () => {
    await service.select({
      goal: 'MAINTENANCE',
      daysPerWeek: 2,
      equipment: 'BODYWEIGHT',
      restrictions: [],
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'APPROVED' }),
    );
  });
});
