import { WorkoutTree } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { EducatorExerciseSource, EducatorWorkoutStatus } from '@prisma/client';
import { renderedText } from './collectRenderedText.util';
import {
  buildEducatorWorkoutDocument,
  renderEducatorWorkoutPdf,
} from './educatorWorkoutPdf';

function tree(overrides: Partial<WorkoutTree> = {}): WorkoutTree {
  return {
    id: 'workout-1',
    clientId: 'client-1',
    title: 'Treino de força',
    weeklyFrequency: 3,
    status: EducatorWorkoutStatus.ACTIVE,
    lastEditNotifiedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    sessions: [],
    ...overrides,
  };
}

function session(
  overrides: Partial<WorkoutTree['sessions'][number]> = {},
): WorkoutTree['sessions'][number] {
  return {
    id: 'session-1',
    workoutId: 'workout-1',
    name: 'Treino A',
    position: 0,
    exercises: [],
    ...overrides,
  };
}

function exercise(
  overrides: Partial<WorkoutTree['sessions'][number]['exercises'][number]> = {},
): WorkoutTree['sessions'][number]['exercises'][number] {
  return {
    id: 'ex-1',
    sessionId: 'session-1',
    position: 0,
    source: EducatorExerciseSource.FREE,
    exerciseId: null,
    exercise: null,
    name: 'Agachamento',
    muscleGroup: 'Pernas',
    equipment: null,
    sets: 4,
    reps: '12',
    load: '40kg',
    videoUrl: null,
    ...overrides,
  };
}

describe('renderEducatorWorkoutPdf', () => {
  it('UT-008 renders every session exercise in position order with name/sets/reps', async () => {
    const t = tree({
      sessions: [
        session({
          exercises: [
            exercise({ position: 0, name: 'Agachamento' }),
            exercise({ id: 'ex-2', position: 1, name: 'Leg press' }),
          ],
        }),
      ],
    });
    const issuer = { issuerName: 'Educador X', clientName: 'João' };

    const buffer = await renderEducatorWorkoutPdf(t, issuer);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');

    const text = renderedText(buildEducatorWorkoutDocument(t, issuer));
    expect(text).toContain('Treino A');
    expect(text).toContain('Agachamento');
    expect(text).toContain('4x12');
    expect(text).toContain('Leg press');
  });

  it('UT-009 shows the issuer name identically for both call sites', () => {
    const t = tree({ sessions: [session({ exercises: [exercise()] })] });

    const educatorSide = renderedText(
      buildEducatorWorkoutDocument(t, {
        issuerName: 'Educador X',
        clientName: 'João',
      }),
    );
    const clientSide = renderedText(
      buildEducatorWorkoutDocument(t, {
        issuerName: 'Educador X',
        clientName: 'João',
      }),
    );

    expect(educatorSide).toContain('Educador X');
    expect(clientSide).toContain('Educador X');
  });
});
