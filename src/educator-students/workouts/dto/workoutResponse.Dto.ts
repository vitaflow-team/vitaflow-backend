import {
  EducatorExerciseSource,
  EducatorWorkoutStatus,
  ExerciseContraindication,
  ExerciseEquipment,
} from '@prisma/client';

// Response shapes only: plain interfaces, never validated at runtime.
export interface WorkoutSummaryDTO {
  id: string;
  title: string;
  status: EducatorWorkoutStatus;
  weeklyFrequency: number | null;
  sessionCount: number;
  exerciseCount: number;
  updatedAt: string;
}

export interface WorkoutListResponseDTO {
  active: WorkoutSummaryDTO | null;
  drafts: WorkoutSummaryDTO[];
  archived: {
    items: WorkoutSummaryDTO[];
    total: number;
    page: number;
    pageSize: number;
  };
}

export interface WorkoutExerciseResponseDTO {
  id: string;
  source: EducatorExerciseSource;
  exerciseId: string | null;
  name: string;
  muscleGroup: string;
  equipment: ExerciseEquipment | null;
  sets: number;
  reps: string;
  load: string | null;
  /** The educator's own link. */
  videoUrl: string | null;
  /** The library video, while the reference still exists. */
  libraryVideoUrl: string | null;
  /** The student restrictions this exercise runs into; empty when none. */
  conflicts: ExerciseContraindication[];
}

export interface WorkoutSessionResponseDTO {
  id: string;
  /** A, B, C… from the position. */
  label: string;
  name: string;
  exercises: WorkoutExerciseResponseDTO[];
}

export interface WorkoutTreeResponseDTO {
  id: string;
  title: string;
  status: EducatorWorkoutStatus;
  weeklyFrequency: number | null;
  updatedAt: string;
  sessions: WorkoutSessionResponseDTO[];
}

export interface DuplicateResponseDTO {
  copies: Array<{ studentId: string; workoutId: string }>;
}

export interface ConflictsResponseDTO {
  conflicts: Record<string, ExerciseContraindication[]>;
}
