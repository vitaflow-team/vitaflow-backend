import { ExerciseSearchCriteria } from '@/repositories/exercise-library/exerciseSearchCriteria';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { PendingDuplicateCriteria } from '@/repositories/exercise-library/pendingDuplicateCriteria';
import { ReviewDecision } from '@/repositories/exercise-library/reviewDecision';
import {
  Exercise,
  ExerciseEquipment,
  ExerciseStatus,
  Prisma,
} from '@prisma/client';

// In-memory stand-in for the Exercise table: the fakes below apply the same
// filters the real repository sends to Prisma, so service tests can assert
// on what a caller actually gets back.
export const exerciseStore: Exercise[] = [];

let sequence = 0;

export function buildExercise(overrides: Partial<Exercise> = {}): Exercise {
  sequence += 1;
  return {
    id: `exercise-${sequence}`,
    name: `Exercise ${sequence}`,
    description: 'How to perform it.',
    muscleGroup: 'Peito',
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: ExerciseEquipment.GYM,
    contraindications: [],
    difficulty: 'Iniciante',
    imageUrl: null,
    videoUrl: null,
    status: ExerciseStatus.APPROVED,
    sourceAttribution: null,
    sourceLicense: null,
    submittedById: null,
    reviewedById: null,
    rejectionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function seedExercises(...rows: Partial<Exercise>[]): Exercise[] {
  const seeded = rows.map((row) => buildExercise(row));
  exerciseStore.push(...seeded);
  return seeded;
}

export function resetExerciseStore(): void {
  exerciseStore.length = 0;
}

function matchesMuscleGroup(exercise: Exercise, muscleGroup: string): boolean {
  return (
    exercise.muscleGroup.toLowerCase() === muscleGroup.toLowerCase() ||
    exercise.primaryMuscles.includes(muscleGroup)
  );
}

function matchesCriteria(
  exercise: Exercise,
  criteria: ExerciseSearchCriteria,
): boolean {
  if (exercise.status !== criteria.status) return false;
  if (criteria.equipment && exercise.equipment !== criteria.equipment) {
    return false;
  }
  if (
    criteria.muscleGroup &&
    !matchesMuscleGroup(exercise, criteria.muscleGroup)
  ) {
    return false;
  }
  if (criteria.q) {
    return exercise.name.toLowerCase().includes(criteria.q.toLowerCase());
  }
  return true;
}

function isPendingDuplicate(
  exercise: Exercise,
  criteria: PendingDuplicateCriteria,
): boolean {
  return (
    exercise.status === ExerciseStatus.PENDING &&
    exercise.submittedById === criteria.submittedById &&
    exercise.name === criteria.name &&
    exercise.description === criteria.description &&
    exercise.muscleGroup === criteria.muscleGroup &&
    exercise.equipment === criteria.equipment &&
    exercise.createdAt >= criteria.createdSince
  );
}

export const ExercisesRepositoryMock = {
  provide: ExercisesRepository,
  useValue: {
    create: jest
      .fn()
      .mockImplementation((data: Prisma.ExerciseUncheckedCreateInput) => {
        const [created] = seedExercises(data as Partial<Exercise>);
        return Promise.resolve(created);
      }),
    findMany: jest
      .fn()
      .mockImplementation((criteria: ExerciseSearchCriteria) => {
        const matches = exerciseStore
          .filter((exercise) => matchesCriteria(exercise, criteria))
          .slice(criteria.skip, criteria.skip + criteria.take);
        return Promise.resolve(matches);
      }),
    findById: jest.fn().mockImplementation((id: string) => {
      return Promise.resolve(
        exerciseStore.find((exercise) => exercise.id === id) ?? null,
      );
    }),
    findBySubmitter: jest.fn().mockImplementation((submittedById: string) => {
      return Promise.resolve(
        exerciseStore.filter(
          (exercise) => exercise.submittedById === submittedById,
        ),
      );
    }),
    findBySource: jest
      .fn()
      .mockImplementation((name: string, sourceAttribution: string) => {
        return Promise.resolve(
          exerciseStore.find(
            (exercise) =>
              exercise.name === name &&
              exercise.sourceAttribution === sourceAttribution,
          ) ?? null,
        );
      }),
    findPendingDuplicate: jest
      .fn()
      .mockImplementation((criteria: PendingDuplicateCriteria) => {
        return Promise.resolve(
          exerciseStore.find((exercise) =>
            isPendingDuplicate(exercise, criteria),
          ) ?? null,
        );
      }),
    update: jest
      .fn()
      .mockImplementation((id: string, data: Partial<Exercise>) => {
        const exercise = exerciseStore.find((row) => row.id === id);
        const defined = Object.fromEntries(
          Object.entries(data).filter(([, value]) => value !== undefined),
        );
        Object.assign(exercise!, defined, { updatedAt: new Date() });
        return Promise.resolve(exercise);
      }),
    delete: jest.fn().mockImplementation((id: string) => {
      const index = exerciseStore.findIndex((row) => row.id === id);
      exerciseStore.splice(index, 1);
      return Promise.resolve();
    }),
    decidePending: jest
      .fn()
      .mockImplementation((id: string, decision: ReviewDecision) => {
        const exercise = exerciseStore.find((row) => row.id === id);
        if (exercise?.status !== ExerciseStatus.PENDING) {
          return Promise.resolve(false);
        }
        Object.assign(exercise, decision);
        return Promise.resolve(true);
      }),
  },
};
