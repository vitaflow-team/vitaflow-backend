/**
 * Integration tests for PRD `exercise-library` (task_03, one-time import).
 *
 * Runs the real import against the vendored exercemus/exercises dataset and
 * an isolated database, through the real ExercisesRepository.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 * Imported rows are removed before and after the suite.
 */
import { PrismaService } from '@/database/prisma.service';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { ExerciseStatus, Prisma } from '@prisma/client';
import { importExerciseLibrary } from '../scripts/importExerciseLibrary/importExerciseLibrary';
import { loadExercemusDataset } from '../scripts/importExerciseLibrary/loadExercemusDataset';

jest.setTimeout(120_000);

const IMPORTED_ROWS: Prisma.ExerciseWhereInput = {
  sourceAttribution: { contains: 'exercemus/exercises' },
};

describe('Exercise library import integration', () => {
  const { exercises } = loadExercemusDataset();
  let prisma: PrismaService;
  let repository: ExercisesRepository;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    prisma = new PrismaService({
      datasources: { db: { url: process.env.TEST_DATABASE_URL } },
    });
    repository = new ExercisesRepository(prisma);
    await prisma.exercise.deleteMany({ where: IMPORTED_ROWS });
  });

  afterAll(async () => {
    await prisma.exercise.deleteMany({ where: IMPORTED_ROWS });
    await prisma.$disconnect();
  });

  it('imports every mappable entry, each with a non-null equipment value', async () => {
    const summary = await importExerciseLibrary(repository, exercises);
    const rows = await prisma.exercise.findMany({ where: IMPORTED_ROWS });

    expect(summary.imported + summary.skipped.length).toBe(exercises.length);
    expect(summary.imported).toBeGreaterThan(800);
    expect(rows).toHaveLength(summary.imported);
    for (const row of rows) {
      expect(row.equipment).not.toBeNull();
      expect(row.status).toBe(ExerciseStatus.APPROVED);
      expect(row.contraindications).toEqual([]);
      expect(row.sourceLicense).toBeTruthy();
    }
    const countsFromRows = rows.reduce<Record<string, number>>(
      (counts, row) => ({
        ...counts,
        [row.equipment]: (counts[row.equipment] ?? 0) + 1,
      }),
      {},
    );
    expect(countsFromRows).toEqual(summary.importedByEquipment);
  });

  it('does not duplicate previously imported rows on a second run', async () => {
    const before = await prisma.exercise.count({ where: IMPORTED_ROWS });

    const summary = await importExerciseLibrary(repository, exercises);

    expect(summary.imported).toBe(0);
    expect(summary.alreadyImported).toBe(before);
    expect(await prisma.exercise.count({ where: IMPORTED_ROWS })).toBe(before);
  });
});
