// Response shapes only: what a linked student reads of an educator workout.
export interface StudentWorkoutExerciseDTO {
  name: string;
  muscleGroup: string;
  sets: number;
  reps: string;
  load: string | null;
  /** Already the effective link: the educator's, else the library's, else null. */
  videoUrl: string | null;
}

export interface StudentWorkoutSessionDTO {
  id: string;
  label: string;
  name: string;
  exercises: StudentWorkoutExerciseDTO[];
}

export interface StudentEducatorWorkoutDTO {
  educator: { id: string; name: string };
  /** The id of today's scheduled session of this workout, or null. */
  todaySessionId: string | null;
  workout: {
    id: string;
    title: string;
    weeklyFrequency: number | null;
    updatedAt: string;
    sessions: StudentWorkoutSessionDTO[];
  };
}

export interface StudentWorkoutsResponseDTO {
  workouts: StudentEducatorWorkoutDTO[];
}
