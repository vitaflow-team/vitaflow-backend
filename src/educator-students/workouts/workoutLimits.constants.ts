// Every limit of an educator workout, in one place. The frontend schema
// mirrors these values (`_constants/educatorWorkoutLimits.ts`).
export const WORKOUT_TITLE_MAX = 80;
export const WORKOUT_FREQUENCY_MIN = 1;
export const WORKOUT_FREQUENCY_MAX = 7;
export const WORKOUT_SESSIONS_MAX = 7;
export const SESSION_NAME_MAX = 60;
export const SESSION_EXERCISES_MAX = 30;
export const EXERCISE_SETS_MIN = 1;
export const EXERCISE_SETS_MAX = 20;
export const EXERCISE_REPS_MAX = 30;
export const EXERCISE_LOAD_MAX = 30;
export const FREE_EXERCISE_NAME_MAX = 80;
export const VIDEO_URL_MAX = 500;
export const DUPLICATE_TARGETS_MAX = 20;
export const CONFLICT_IDS_MAX = 100;
export const ARCHIVED_PAGE_SIZE = 20;
export const EDIT_NOTIFICATION_WINDOW_MINUTES = 30;
export const COPY_TITLE_SUFFIX = ' (cópia)';

// The same seven values as the frontend catalog (`MUSCLE_GROUPS`); a test
// keeps the two lists equal.
export const MUSCLE_GROUPS = [
  'Abdômen',
  'Braços',
  'Costas',
  'Ombros',
  'Panturrilhas',
  'Peito',
  'Pernas',
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];
