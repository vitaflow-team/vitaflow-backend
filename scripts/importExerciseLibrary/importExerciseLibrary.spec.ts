import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { ExerciseEquipment, ExerciseStatus } from '@prisma/client';
import {
  ExercisesRepositoryMock,
  exerciseStore,
  resetExerciseStore,
} from 'mock/exercisesRepository.mock';
import { classifyEquipment } from './classifyEquipment';
import { EQUIPMENT_BY_EXERCISE_NAME } from './equipmentMapping';
import { ExercemusExercise } from './exercemusExercise';
import { importExerciseLibrary } from './importExerciseLibrary';
import { loadExercemusDataset } from './loadExercemusDataset';
import {
  DEFAULT_SOURCE_ATTRIBUTION,
  DEFAULT_SOURCE_LICENSE,
  mapExercemusExercise,
} from './mapExercemusExercise';

const { exercises } = loadExercemusDataset();
// Every entry the real dataset cannot yield a valid row for: two need gear no
// equipment category describes, five have neither description nor
// instructions (description is required).
const SKIPPED = [
  'Bicycling',
  'Iron Cross',
  'One-Arm Kettlebell Swings',
  'Push Press',
  'Side Bridge',
  'Side Jackknife',
  'Skating',
];

function datasetEntry(name: string): ExercemusExercise {
  const entry = exercises.find((exercise) => exercise.name === name);
  if (!entry) throw new Error(`"${name}" is not in the vendored dataset`);
  return entry;
}

function classify(name: string): ExerciseEquipment | string {
  const result = classifyEquipment(datasetEntry(name));
  return result.ok ? result.value : result.reason;
}

describe('exercemus equipment classification (real dataset entries)', () => {
  it.each([
    ['Barbell Curl', ['barbell'], ExerciseEquipment.GYM],
    ['Machine Chest Fly', ['machine'], ExerciseEquipment.GYM],
    ['Arnold Dumbbell Press', ['dumbbell'], ExerciseEquipment.HOME_BASIC],
    ['Band Good Morning', ['bands'], ExerciseEquipment.HOME_BASIC],
    ['3/4 Sit-Up', ['none'], ExerciseEquipment.BODYWEIGHT],
    ['Barbell Bench Press', ['barbell', 'bench'], ExerciseEquipment.GYM],
    ['Dumbbell Skullcrusher', ['dumbbell', 'bench'], ExerciseEquipment.GYM],
  ])('maps "%s" %j to %s', (name, tags, expected) => {
    expect(datasetEntry(name).equipment).toEqual(tags);
    expect(classify(name)).toBe(expected);
  });

  it.each([
    ['Tire Flip', ExerciseEquipment.GYM],
    ['Muscle Up', ExerciseEquipment.HOME_BASIC],
    ['Quad Stretch', ExerciseEquipment.BODYWEIGHT],
  ])('resolves the "other"-tagged "%s" by name to %s', (name, expected) => {
    expect(datasetEntry(name).equipment).toEqual(['other']);
    expect(classify(name)).toBe(expected);
  });

  it.each([
    ['Body Tricep Press', ExerciseEquipment.GYM],
    ['Pullups', ExerciseEquipment.HOME_BASIC],
  ])('corrects the mistagged "none" entry "%s" to %s', (name, expected) => {
    expect(datasetEntry(name).equipment).toEqual(['none']);
    expect(classify(name)).toBe(expected);
  });

  it('has a name entry for every "other"-tagged exercise', () => {
    const missing = exercises.filter(
      (exercise) =>
        exercise.equipment.includes('other') &&
        !Object.hasOwn(EQUIPMENT_BY_EXERCISE_NAME, exercise.name),
    );

    expect(missing).toEqual([]);
  });

  it('has no name entry for an exercise missing from the dataset', () => {
    const names = new Set(exercises.map((exercise) => exercise.name));
    const stale = Object.keys(EQUIPMENT_BY_EXERCISE_NAME).filter(
      (name) => !names.has(name),
    );

    expect(stale).toEqual([]);
  });

  it('skips an unknown tag instead of guessing', () => {
    const entry = { ...datasetEntry('Barbell Curl'), equipment: ['sled'] };

    expect(classifyEquipment(entry)).toEqual({
      ok: false,
      reason: 'unclassified equipment tag "sled"',
    });
  });
});

describe('mapExercemusExercise', () => {
  it('maps every dataset entry except the known skips', () => {
    const skipped = exercises.filter(
      (exercise) => !mapExercemusExercise(exercise).ok,
    );

    expect(skipped.map((exercise) => exercise.name).sort()).toEqual(SKIPPED);
  });

  it('imports APPROVED rows with empty contraindications and a source', () => {
    for (const exercise of exercises) {
      const mapped = mapExercemusExercise(exercise);
      if (!mapped.ok) continue;

      expect(mapped.value).toMatchObject({
        status: ExerciseStatus.APPROVED,
        contraindications: [],
        sourceAttribution: expect.any(String),
        sourceLicense: expect.any(String),
      });
      expect(Object.values(ExerciseEquipment)).toContain(
        mapped.value.equipment,
      );
    }
  });

  it('maps fields and the default source for an entry without a license', () => {
    const mapped = mapExercemusExercise(datasetEntry('3/4 Sit-Up'));

    expect(mapped).toMatchObject({
      ok: true,
      value: {
        name: '3/4 Sit-Up',
        muscleGroup: 'Abdômen',
        primaryMuscles: ['abs'],
        videoUrl: 'https://www.youtube.com/watch?v=wm47Swzn_98',
        sourceAttribution: DEFAULT_SOURCE_ATTRIBUTION,
        sourceLicense: DEFAULT_SOURCE_LICENSE,
      },
    });
    const description = mapped.ok ? String(mapped.value.description) : '';
    expect(description).toMatch(/^Sit-Up performed 3\/4 of the way up\nLie/);
  });

  it('keeps the per-record license of an entry that carries one', () => {
    const mapped = mapExercemusExercise(datasetEntry('Dumbbell Skullcrusher'));

    expect(mapped).toMatchObject({
      ok: true,
      value: {
        sourceAttribution: 'wger.de via exercemus/exercises',
        sourceLicense: 'CC-BY-SA 3',
      },
    });
  });
});

describe('importExerciseLibrary', () => {
  const repository =
    ExercisesRepositoryMock.useValue as unknown as ExercisesRepository;

  beforeEach(() => resetExerciseStore());

  it('imports every mappable entry and reports the breakdown', async () => {
    const summary = await importExerciseLibrary(repository, exercises);

    expect(summary.total).toBe(exercises.length);
    expect(summary.imported).toBe(exercises.length - SKIPPED.length);
    expect(summary.alreadyImported).toBe(0);
    expect(summary.skipped.map(({ name }) => name).sort()).toEqual(SKIPPED);
    const byEquipment = Object.values(summary.importedByEquipment);
    expect(byEquipment.reduce((sum, count) => sum + count, 0)).toBe(
      summary.imported,
    );
    expect(exerciseStore).toHaveLength(summary.imported);
  });

  it('does not duplicate rows when run a second time', async () => {
    await importExerciseLibrary(repository, exercises);
    const second = await importExerciseLibrary(repository, exercises);

    expect(second.imported).toBe(0);
    expect(second.alreadyImported).toBe(exercises.length - SKIPPED.length);
    expect(exerciseStore).toHaveLength(exercises.length - SKIPPED.length);
  });
});
