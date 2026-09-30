import { ExerciseEquipment, ExerciseStatus } from '@prisma/client';

// Every filter is optional except `status`: callers must always state which
// review state they are allowed to see, so no query can leak other states.
export interface ExerciseSearchCriteria {
  status: ExerciseStatus;
  muscleGroup?: string;
  equipment?: ExerciseEquipment;
  q?: string;
  skip: number;
  take: number;
}
