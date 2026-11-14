import { Exercise, ExerciseEquipment } from '@prisma/client';
import { GeneratedPlan } from '@/workouts/ruleEngine.types';
import { toEducatorWorkoutInput } from './educatorAiWorkoutGeneration.util';

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex-1',
    name: 'Supino reto',
    description: '',
    muscleGroup: 'Peito',
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: ExerciseEquipment.GYM,
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Exercise;
}

describe('toEducatorWorkoutInput', () => {
  // UT-001
  it('stringifies reps, leaves load null, and copies name/muscleGroup/equipment from the library exercise', () => {
    const plan: GeneratedPlan = {
      scaled: false,
      days: [
        {
          dayOfWeek: 1,
          exercises: [
            { exerciseId: 'ex-1', sets: 3, reps: 10, order: 1 },
            { exerciseId: 'ex-2', sets: 4, reps: 8, order: 2 },
          ],
        },
      ],
    };
    const exercisesById = new Map([
      [
        'ex-1',
        exercise({ id: 'ex-1', name: 'Supino reto', muscleGroup: 'Peito' }),
      ],
      [
        'ex-2',
        exercise({
          id: 'ex-2',
          name: 'Remada curvada',
          muscleGroup: 'Costas',
          equipment: ExerciseEquipment.HOME_BASIC,
        }),
      ],
    ]);

    const result = toEducatorWorkoutInput(
      'Treino gerado por IA',
      3,
      plan,
      exercisesById,
    );

    expect(result.title).toBe('Treino gerado por IA');
    expect(result.weeklyFrequency).toBe(3);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].exercises).toEqual([
      expect.objectContaining({
        source: 'LIBRARY',
        exerciseId: 'ex-1',
        name: 'Supino reto',
        muscleGroup: 'Peito',
        equipment: ExerciseEquipment.GYM,
        sets: 3,
        reps: '10',
        load: null,
      }),
      expect.objectContaining({
        source: 'LIBRARY',
        exerciseId: 'ex-2',
        name: 'Remada curvada',
        muscleGroup: 'Costas',
        equipment: ExerciseEquipment.HOME_BASIC,
        sets: 4,
        reps: '8',
        load: null,
      }),
    ]);
  });

  // UT-002
  it('produces no sessions when the plan has no days', () => {
    const plan: GeneratedPlan = { days: [], scaled: false };

    const result = toEducatorWorkoutInput(
      'Treino gerado por IA',
      0,
      plan,
      new Map(),
    );

    expect(result.sessions).toEqual([]);
  });

  // UT-003
  it('throws when a generated exercise id is missing from the exercise map', () => {
    const plan: GeneratedPlan = {
      scaled: false,
      days: [
        {
          dayOfWeek: 1,
          exercises: [{ exerciseId: 'missing', sets: 3, reps: 10, order: 1 }],
        },
      ],
    };

    expect(() =>
      toEducatorWorkoutInput('Treino', 1, plan, new Map()),
    ).toThrow();
  });
});
