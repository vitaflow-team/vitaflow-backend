import { PrismaService } from '@/database/prisma.service';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { Logger } from '@nestjs/common';
import {
  importExerciseLibrary,
  logImportSummary,
} from './importExerciseLibrary';
import { loadExercemusDataset } from './loadExercemusDataset';

// One-time catalog import; run manually, see README.md. Not part of
// `prisma db seed` or any install step.
const logger = new Logger('ExerciseLibraryImport');
const prisma = new PrismaService();

async function main(): Promise<void> {
  const { exercises } = loadExercemusDataset(process.argv[2]);
  logger.log(`Importing ${exercises.length} exercemus/exercises entries`);
  const summary = await importExerciseLibrary(
    new ExercisesRepository(prisma),
    exercises,
  );
  logImportSummary(summary, logger);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    logger.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
