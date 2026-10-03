import { WorkoutTree } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import {
  EducatorExerciseSource,
  ExerciseContraindication,
} from '@prisma/client';
import { WorkoutTreeResponseDTO } from './dto/workoutResponse.Dto';
import { sessionLabel } from './workoutTree.util';

/**
 * The educator's view of a tree. A library item whose reference is gone
 * (the library deleted the exercise) is reported as a free item: it keeps the
 * name and muscle group saved with it and has no library video.
 */
export function toTreeResponse(
  tree: WorkoutTree,
  conflicts: Map<string, ExerciseContraindication[]>,
): WorkoutTreeResponseDTO {
  return {
    id: tree.id,
    title: tree.title,
    status: tree.status,
    weeklyFrequency: tree.weeklyFrequency,
    updatedAt: tree.updatedAt.toISOString(),
    sessions: tree.sessions.map((session, position) => ({
      id: session.id,
      label: sessionLabel(position),
      name: session.name,
      exercises: session.exercises.map((exercise) => ({
        id: exercise.id,
        source:
          exercise.source === EducatorExerciseSource.LIBRARY &&
          !exercise.exerciseId
            ? EducatorExerciseSource.FREE
            : exercise.source,
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        muscleGroup: exercise.muscleGroup,
        equipment: exercise.equipment,
        sets: exercise.sets,
        reps: exercise.reps,
        load: exercise.load,
        videoUrl: exercise.videoUrl,
        libraryVideoUrl: exercise.exercise?.videoUrl ?? null,
        conflicts: conflicts.get(exercise.id) ?? [],
      })),
    })),
  };
}
