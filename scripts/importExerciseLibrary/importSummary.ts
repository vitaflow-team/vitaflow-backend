import { ExerciseEquipment } from '@prisma/client';
import { SkippedExercise } from './skippedExercise';

export interface ImportSummary {
  total: number;
  imported: number;
  importedByEquipment: Record<ExerciseEquipment, number>;
  alreadyImported: number;
  skipped: SkippedExercise[];
}
