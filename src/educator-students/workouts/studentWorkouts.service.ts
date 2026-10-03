import {
  ActiveWorkoutWithEducator,
  EducatorWorkoutsRepository,
} from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { Injectable } from '@nestjs/common';
import { StudentWorkoutsResponseDTO } from './dto/studentWorkout.Dto';
import { effectiveVideoUrl, sessionLabel } from './workoutTree.util';

function toStudentWorkout(row: ActiveWorkoutWithEducator) {
  return {
    educator: {
      id: row.client.professional.id,
      name: row.client.professional.name,
    },
    workout: {
      id: row.id,
      title: row.title,
      weeklyFrequency: row.weeklyFrequency,
      updatedAt: row.updatedAt.toISOString(),
      sessions: row.sessions.map((session, position) => ({
        id: session.id,
        label: sessionLabel(position),
        name: session.name,
        exercises: session.exercises.map((exercise) => ({
          name: exercise.name,
          muscleGroup: exercise.muscleGroup,
          sets: exercise.sets,
          reps: exercise.reps,
          load: exercise.load,
          videoUrl: effectiveVideoUrl(exercise),
        })),
      })),
    },
  };
}

// The student's read-only side: only the active workouts of the records linked
// to the caller. No drafts, no archive, no status, no conflict data.
@Injectable()
export class StudentWorkoutsService {
  constructor(private readonly workouts: EducatorWorkoutsRepository) {}

  async getActiveForUser(userId: string): Promise<StudentWorkoutsResponseDTO> {
    const rows = await this.workouts.findActiveByLinkedUser(userId);
    return { workouts: rows.map(toStudentWorkout) };
  }
}
