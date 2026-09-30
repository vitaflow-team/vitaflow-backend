import { ExerciseStatus, Prisma } from '@prisma/client';
import { classifyEquipment } from './classifyEquipment';
import { ExercemusExercise } from './exercemusExercise';
import { MappingResult } from './mappingResult';
import { MUSCLE_GROUP_BY_MUSCLE } from './muscleGroupMapping';

const DATASET_ATTRIBUTION = 'exercemus/exercises';

// Entries without their own license block carry no per-record terms; ADR-001
// treats the imported dataset as a CC-BY-SA derivative of wger, so they get
// that license rather than a less restrictive guess.
export const DEFAULT_SOURCE_ATTRIBUTION = `${DATASET_ATTRIBUTION} (wger.de, wrkout/exercises.json)`;
export const DEFAULT_SOURCE_LICENSE = 'CC-BY-SA 3.0';

export function mapExercemusExercise(
  exercise: ExercemusExercise,
): MappingResult<Prisma.ExerciseUncheckedCreateInput> {
  const equipment = classifyEquipment(exercise);
  if (!equipment.ok) return equipment;

  const headlineMuscle = exercise.primary_muscles[0];
  if (!Object.hasOwn(MUSCLE_GROUP_BY_MUSCLE, headlineMuscle)) {
    return { ok: false, reason: `unmapped primary muscle "${headlineMuscle}"` };
  }

  const description = [exercise.description, ...exercise.instructions]
    .map((line) => line?.trim())
    .filter(Boolean)
    .join('\n');
  if (!description) return { ok: false, reason: 'no description' };

  return {
    ok: true,
    value: {
      name: exercise.name,
      description,
      muscleGroup: MUSCLE_GROUP_BY_MUSCLE[headlineMuscle],
      primaryMuscles: exercise.primary_muscles,
      secondaryMuscles: exercise.secondary_muscles,
      equipment: equipment.value,
      contraindications: [],
      imageUrl: exercise.images?.[0] ?? null,
      videoUrl: exercise.video ?? null,
      status: ExerciseStatus.APPROVED,
      ...toSource(exercise),
    },
  };
}

function toSource(exercise: ExercemusExercise) {
  if (!exercise.license) {
    return {
      sourceAttribution: DEFAULT_SOURCE_ATTRIBUTION,
      sourceLicense: DEFAULT_SOURCE_LICENSE,
    };
  }
  return {
    sourceAttribution: exercise.license_author
      ? `${exercise.license_author} via ${DATASET_ATTRIBUTION}`
      : DATASET_ATTRIBUTION,
    sourceLicense: exercise.license.short_name,
  };
}
