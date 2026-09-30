import { ExerciseEquipment } from '@prisma/client';

export interface PendingDuplicateCriteria {
  submittedById: string;
  name: string;
  description: string;
  muscleGroup: string;
  equipment: ExerciseEquipment;
  createdSince: Date;
}
