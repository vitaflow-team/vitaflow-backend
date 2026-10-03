import { CodedError } from '@/common/errors/codedError';
import { WorkoutTree } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { EducatorExerciseSource, Exercise } from '@prisma/client';
import { SaveWorkoutDTO } from './dto/saveWorkout.Dto';
import { WorkoutTreeInput } from './workoutTree.util';

function foreignItem(): CodedError {
  return new CodedError(
    'Há itens que não pertencem a este treino.',
    400,
    'foreign_item_id',
  );
}

// Every id in the request must belong to the workout being saved, and none may
// appear twice: otherwise nothing is written.
function assertOwnIds(dto: SaveWorkoutDTO, current: WorkoutTree): void {
  const ownSessions = new Set(current.sessions.map((s) => s.id));
  const ownExercises = new Set(
    current.sessions.flatMap((s) => s.exercises.map((e) => e.id)),
  );
  const seen = new Set<string>();

  for (const session of dto.sessions) {
    if (session.id && (!ownSessions.has(session.id) || seen.has(session.id))) {
      throw foreignItem();
    }
    if (session.id) seen.add(session.id);

    for (const exercise of session.exercises) {
      if (!exercise.id) continue;
      if (!ownExercises.has(exercise.id) || seen.has(exercise.id)) {
        throw foreignItem();
      }
      seen.add(exercise.id);
    }
  }
}

async function loadLibrary(
  dto: SaveWorkoutDTO,
  library: ExercisesRepository,
): Promise<Map<string, Exercise>> {
  const ids = [
    ...new Set(
      dto.sessions.flatMap((session) =>
        session.exercises
          .filter((item) => item.source === EducatorExerciseSource.LIBRARY)
          .map((item) => item.exerciseId as string),
      ),
    ),
  ];
  if (ids.length === 0) return new Map();

  const found = await library.findApprovedByIds(ids);
  if (found.length !== ids.length) {
    throw new CodedError(
      'Algum exercício da biblioteca não foi encontrado ou não está aprovado.',
      400,
      'invalid_library_exercise',
    );
  }
  return new Map(found.map((exercise) => [exercise.id, exercise]));
}

/**
 * Validates the ids of a saved tree and turns it into what the repository
 * writes: a library item takes its name, muscle group and equipment from the
 * approved library exercise at this moment (and keeps them if the library
 * later changes); a free item keeps what the educator typed.
 */
export async function resolveTree(
  dto: SaveWorkoutDTO,
  current: WorkoutTree,
  library: ExercisesRepository,
): Promise<WorkoutTreeInput> {
  assertOwnIds(dto, current);
  const exercises = await loadLibrary(dto, library);

  return {
    title: dto.title,
    weeklyFrequency: dto.weeklyFrequency ?? null,
    sessions: dto.sessions.map((session) => ({
      id: session.id,
      name: session.name,
      exercises: session.exercises.map((item) => {
        const fromLibrary =
          item.source === EducatorExerciseSource.LIBRARY
            ? exercises.get(item.exerciseId as string)
            : undefined;

        return {
          id: item.id,
          source: item.source,
          exerciseId: fromLibrary ? fromLibrary.id : null,
          name: fromLibrary ? fromLibrary.name : (item.name as string),
          muscleGroup: fromLibrary
            ? fromLibrary.muscleGroup
            : (item.muscleGroup as string),
          equipment: fromLibrary
            ? fromLibrary.equipment
            : (item.equipment ?? null),
          sets: item.sets,
          reps: item.reps,
          load: item.load ?? null,
          videoUrl: item.videoUrl ?? null,
        };
      }),
    })),
  };
}
