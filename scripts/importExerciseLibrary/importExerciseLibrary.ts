import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { Logger } from '@nestjs/common';
import { ExerciseEquipment, Prisma } from '@prisma/client';
import { ExercemusExercise } from './exercemusExercise';
import { ImportSummary } from './importSummary';
import { mapExercemusExercise } from './mapExercemusExercise';

// Inserts every mappable dataset entry as an APPROVED exercise. Re-running is
// safe: a row already present with the same name and source attribution is
// left untouched, so an interrupted run can simply be started again.
export async function importExerciseLibrary(
  repository: ExercisesRepository,
  exercises: ExercemusExercise[],
): Promise<ImportSummary> {
  const summary = createEmptySummary(exercises.length);

  for (const exercise of exercises) {
    const mapped = mapExercemusExercise(exercise);
    if (!mapped.ok) {
      summary.skipped.push({ name: exercise.name, reason: mapped.reason });
      continue;
    }
    if (await isAlreadyImported(repository, mapped.value)) {
      summary.alreadyImported += 1;
      continue;
    }
    await repository.create(mapped.value);
    summary.imported += 1;
    summary.importedByEquipment[mapped.value.equipment] += 1;
  }

  return summary;
}

export function logImportSummary(summary: ImportSummary, logger: Logger): void {
  const byEquipment = Object.entries(summary.importedByEquipment)
    .map(([equipment, count]) => `${equipment}=${count}`)
    .join(', ');

  logger.log(`Dataset entries: ${summary.total}`);
  logger.log(`Imported: ${summary.imported} (${byEquipment})`);
  logger.log(`Already imported, left untouched: ${summary.alreadyImported}`);
  logger.log(`Skipped: ${summary.skipped.length}`);
  for (const { name, reason } of summary.skipped) {
    logger.warn(`Skipped "${name}": ${reason}`);
  }
}

async function isAlreadyImported(
  repository: ExercisesRepository,
  data: Prisma.ExerciseUncheckedCreateInput,
): Promise<boolean> {
  const existing = await repository.findBySource(
    data.name,
    data.sourceAttribution!,
  );
  return existing !== null;
}

function createEmptySummary(total: number): ImportSummary {
  return {
    total,
    imported: 0,
    importedByEquipment: {
      [ExerciseEquipment.GYM]: 0,
      [ExerciseEquipment.HOME_BASIC]: 0,
      [ExerciseEquipment.BODYWEIGHT]: 0,
    },
    alreadyImported: 0,
    skipped: [],
  };
}
