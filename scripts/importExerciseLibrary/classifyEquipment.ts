import { ExerciseEquipment } from '@prisma/client';
import {
  EQUIPMENT_BY_EXERCISE_NAME,
  EQUIPMENT_BY_TAG,
  EQUIPMENT_PRIORITY,
} from './equipmentMapping';
import { ExercemusExercise } from './exercemusExercise';
import { MappingResult } from './mappingResult';

export function classifyEquipment(
  exercise: ExercemusExercise,
): MappingResult<ExerciseEquipment> {
  if (Object.hasOwn(EQUIPMENT_BY_EXERCISE_NAME, exercise.name)) {
    const equipment = EQUIPMENT_BY_EXERCISE_NAME[exercise.name];
    return equipment
      ? { ok: true, value: equipment }
      : { ok: false, reason: 'excluded by the equipment mapping table' };
  }
  if (exercise.equipment.length === 0) {
    return { ok: false, reason: 'no equipment tag' };
  }

  const classified: ExerciseEquipment[] = [];
  for (const tag of exercise.equipment) {
    const equipment = Object.hasOwn(EQUIPMENT_BY_TAG, tag)
      ? EQUIPMENT_BY_TAG[tag]
      : null;
    if (!equipment) {
      return { ok: false, reason: `unclassified equipment tag "${tag}"` };
    }
    classified.push(equipment);
  }

  const mostDemanding = EQUIPMENT_PRIORITY.find((equipment) =>
    classified.includes(equipment),
  )!;
  return { ok: true, value: mostDemanding };
}
