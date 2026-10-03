// Limits of a fixed weekly time (TechSpec Data Models). The frontend schema
// mirrors these values; change both together.
export const FIXED_TIME_LIMIT_PER_STUDENT = 14;
export const FIXED_WEEKDAY_MIN = 1;
export const FIXED_WEEKDAY_MAX = 7;
export const FIXED_START_STEP_MINUTES = 5;
export const FIXED_START_MAX_MINUTE = 1435;
export const FIXED_DURATION_DEFAULT_MINUTES = 60;
export const FIXED_DURATION_MIN_MINUTES = 15;
export const FIXED_DURATION_MAX_MINUTES = 240;
export const FIXED_DAY_MINUTES = 1440;
export const FIXED_ONLINE_LINK_MAX = 500;
export const FIXED_WORKOUT_LETTERS = 'ABCDEFG';

// Sessions are materialized this many days ahead (ADR-006) and the list shows
// this many days (TechSpec Data Models).
export const FIXED_MATERIALIZE_DAYS = 35;
export const FIXED_DISPLAY_DAYS = 28;

export const FIXED_TIME_NOT_FOUND = 'Horário fixo não encontrado.';
export const FIXED_SESSION_NOT_FOUND = 'Sessão não encontrada.';

// The notice tells the linked student that their educator changed the time.
export const SCHEDULE_CHANGE_LINK = '/restrict/scheduling';
