import { WorkoutWithDetails } from '@/repositories/workouts/workouts.repository';
import {
  Exercise,
  ExerciseEquipment,
  ExerciseStatus,
  FitnessGoal,
} from '@prisma/client';
import { renderedText } from './collectRenderedText.util';
import { buildAiWorkoutDocument, renderAiWorkoutPdf } from './aiWorkoutPdf';

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'exercise-1',
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
    status: ExerciseStatus.APPROVED,
    sourceAttribution: null,
    sourceLicense: null,
    submittedById: null,
    reviewedById: null,
    rejectionReason: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function workoutExercise(
  overrides: Partial<
    WorkoutWithDetails['days'][number]['exercises'][number]
  > = {},
): WorkoutWithDetails['days'][number]['exercises'][number] {
  return {
    id: 'we-1',
    workoutDayId: 'day-1',
    exerciseId: 'exercise-1',
    exercise: exercise(),
    sets: 3,
    reps: 10,
    order: 0,
    ...overrides,
  };
}

function workout(
  overrides: Partial<WorkoutWithDetails> = {},
): WorkoutWithDetails {
  return {
    id: 'workout-1',
    userId: 'user-1',
    goal: FitnessGoal.MUSCLE_GAIN,
    daysPerWeek: 3,
    explanation: 'Plano focado em hipertrofia.',
    days: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

const issuer = { issuerName: null, clientName: 'Maria' };

describe('renderAiWorkoutPdf', () => {
  it('UT-005 includes the explanation and every exercise name/sets/reps in order', async () => {
    const w = workout({
      days: [
        {
          id: 'day-1',
          workoutId: 'workout-1',
          dayOfWeek: 1,
          exercises: [workoutExercise()],
        },
      ],
    });

    const buffer = await renderAiWorkoutPdf(w, issuer);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');

    const text = renderedText(buildAiWorkoutDocument(w, issuer));
    expect(text).toContain('Plano focado em hipertrofia.');
    expect(text).toContain('Supino reto');
    expect(text).toContain('3x10');
  });

  it('UT-006 renders an unavailable label for a null exerciseId', () => {
    const w = workout({
      days: [
        {
          id: 'day-1',
          workoutId: 'workout-1',
          dayOfWeek: 1,
          exercises: [workoutExercise({ exerciseId: null, exercise: null })],
        },
      ],
    });

    const text = renderedText(buildAiWorkoutDocument(w, issuer));
    expect(text).toContain('indisponível');
  });

  it('UT-007 a day with zero exercises still renders with an indication', () => {
    const w = workout({
      days: [
        { id: 'day-1', workoutId: 'workout-1', dayOfWeek: 2, exercises: [] },
      ],
    });

    const text = renderedText(buildAiWorkoutDocument(w, issuer));
    expect(text).toContain('Terça-feira');
    expect(text).toContain('Nenhum exercício neste dia.');
  });
});
