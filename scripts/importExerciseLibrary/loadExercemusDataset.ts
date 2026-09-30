import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExercemusDataset } from './exercemusDataset';

// Vendored copy of exercemus/exercises `exercises.json`; see README.md for
// the pinned upstream commit.
export const VENDORED_DATASET_PATH = join(
  __dirname,
  'data',
  'exercemusExercises.json',
);

export function loadExercemusDataset(
  path = VENDORED_DATASET_PATH,
): ExercemusDataset {
  return JSON.parse(readFileSync(path, 'utf8')) as ExercemusDataset;
}
