import { FitnessExperienceLevel } from '@prisma/client';

// `Exercise.difficulty` is free text with no enforced vocabulary. Same
// rationale as `muscleFocus.constants.ts` (ADR-014): map through this table
// instead of matching the catalog directly.
export const EXPERIENCE_LEVEL_TO_DIFFICULTY: Record<
  FitnessExperienceLevel,
  string[]
> = {
  BEGINNER: ['Iniciante'],
  INTERMEDIATE: ['Médio'],
  ADVANCED: ['Avançado'],
};
