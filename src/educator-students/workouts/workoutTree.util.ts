import {
  EducatorExerciseSource,
  ExerciseContraindication,
  ExerciseEquipment,
} from '@prisma/client';
import { COPY_TITLE_SUFFIX } from './workoutLimits.constants';

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The label of a session from its position: A, B, C… It is never stored. */
export function sessionLabel(position: number): string {
  return LABELS[position] ?? String(position + 1);
}

export interface ExerciseItemInput {
  id?: string;
  source: EducatorExerciseSource;
  exerciseId: string | null;
  name: string;
  muscleGroup: string;
  equipment: ExerciseEquipment | null;
  sets: number;
  reps: string;
  load: string | null;
  videoUrl: string | null;
}

export interface SessionInput {
  id?: string;
  name: string;
  exercises: ExerciseItemInput[];
}

export interface WorkoutTreeInput {
  title: string;
  weeklyFrequency: number | null;
  sessions: SessionInput[];
}

export interface ActivationProblem {
  code: 'no_sessions' | 'empty_session';
  /** The label and name of the session that has no exercise. */
  sessionLabel?: string;
  sessionName?: string;
}

/**
 * A workout may be active only when it has at least one session and every
 * session has at least one exercise. An empty result means it is valid.
 */
export function validateActivatable(tree: {
  sessions: Array<{ name: string; exercises: unknown[] }>;
}): ActivationProblem[] {
  if (tree.sessions.length === 0) return [{ code: 'no_sessions' }];

  return tree.sessions.flatMap((session, position) =>
    session.exercises.length === 0
      ? [
          {
            code: 'empty_session' as const,
            sessionLabel: sessionLabel(position),
            sessionName: session.name,
          },
        ]
      : [],
  );
}

export interface ExerciseWithTags {
  id: string;
  /** The library exercise's tags; absent for a free item or a cleared reference. */
  contraindications: ExerciseContraindication[] | null | undefined;
}

/**
 * Which of the student's restrictions each item runs into. Only the
 * intersecting values are returned, and only for items that have library
 * tags: free items and items whose library reference is gone never conflict.
 */
export function computeConflicts(
  exercises: ExerciseWithTags[],
  restrictions: ExerciseContraindication[],
): Map<string, ExerciseContraindication[]> {
  const conflicts = new Map<string, ExerciseContraindication[]>();
  if (restrictions.length === 0) return conflicts;

  for (const exercise of exercises) {
    const tags = exercise.contraindications ?? [];
    const hits = restrictions.filter((restriction) =>
      tags.includes(restriction),
    );
    if (hits.length > 0) conflicts.set(exercise.id, hits);
  }
  return conflicts;
}

export interface CopySource {
  title: string;
  weeklyFrequency: number | null;
  sessions: Array<{
    name: string;
    exercises: Array<Omit<ExerciseItemInput, 'id'> & { id?: string }>;
  }>;
}

export interface CopyTreeInput extends WorkoutTreeInput {
  status: 'DRAFT';
}

/**
 * A copy of a workout for another record: no ids, always a draft, the same
 * order and values (saved names included, even when the library reference
 * has since been cleared).
 */
export function toCopyTree(
  source: CopySource,
  withCopySuffix = false,
): CopyTreeInput {
  return {
    status: 'DRAFT',
    title: withCopySuffix
      ? `${source.title}${COPY_TITLE_SUFFIX}`
      : source.title,
    weeklyFrequency: source.weeklyFrequency,
    sessions: source.sessions.map((session) => ({
      name: session.name,
      exercises: session.exercises.map((exercise) => ({
        source: exercise.source,
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        muscleGroup: exercise.muscleGroup,
        equipment: exercise.equipment,
        sets: exercise.sets,
        reps: exercise.reps,
        load: exercise.load,
        videoUrl: exercise.videoUrl,
      })),
    })),
  };
}

/**
 * The link a student opens: the educator's own link first, else the library
 * video while the reference still exists, else nothing.
 */
export function effectiveVideoUrl(item: {
  videoUrl: string | null;
  exercise?: { videoUrl: string | null } | null;
}): string | null {
  return item.videoUrl ?? item.exercise?.videoUrl ?? null;
}
