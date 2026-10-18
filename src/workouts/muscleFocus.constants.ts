import { MuscleFocus } from '@prisma/client';

// `Exercise.muscleGroup` is free text with no enforced vocabulary (imported
// from external sources). `MuscleFocus` stays a closed, known field (ADR-007)
// by mapping through this table instead of matching the catalog directly
// (ADR-014) — add a synonym here, not a new enum value, when the catalog's
// vocabulary grows.
export const MUSCLE_FOCUS_TO_CATALOG_VALUES: Record<MuscleFocus, string[]> = {
  CHEST: ['Peito'],
  BACK: ['Costas'],
  LEGS: ['Pernas'],
  SHOULDERS: ['Ombro'],
  ABDOMEN: ['Abdômen'],
};
