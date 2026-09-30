import { FitnessGoal, Sex } from '@prisma/client';

export interface CalorieGoalInput {
  sex: Sex | null | undefined;
  goal: FitnessGoal | null | undefined;
  weightKg: number | null | undefined;
  heightCm: number | null | undefined;
  birthDate: Date | null | undefined;
}

const SEX_OFFSET: Record<Sex, number> = {
  MALE: 5,
  FEMALE: -161,
};

// Fixed "moderately active" multiplier (ADR-004) — no activity-level
// question is asked, per that ADR's rejected-alternative rationale.
const ACTIVITY_FACTOR = 1.55;

const GOAL_ADJUSTMENT: Record<FitnessGoal, number> = {
  WEIGHT_LOSS: -500,
  MUSCLE_GAIN: 300,
  CONDITIONING: 0,
  MAINTENANCE: 0,
};

function ageFromBirthDate(birthDate: Date, today: Date): number {
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  const hadBirthdayThisYear =
    today.getUTCMonth() > birthDate.getUTCMonth() ||
    (today.getUTCMonth() === birthDate.getUTCMonth() &&
      today.getUTCDate() >= birthDate.getUTCDate());
  if (!hadBirthdayThisYear) age--;
  return age;
}

// Mifflin-St Jeor BMR × a fixed activity factor, adjusted by fitness goal
// (ADR-004). Pure and computed fresh on every call — never cached or
// stored — so it always reflects the latest FitnessProfile/MeasurementRecord
// state. Returns null when any required input is missing rather than
// guessing or defaulting, per this feature's "goal withheld, never blocks
// logging" rule.
export function calculateDailyCalorieGoal(
  input: CalorieGoalInput,
  today: Date = new Date(),
): number | null {
  const { sex, goal, weightKg, heightCm, birthDate } = input;
  if (!sex || !goal || !weightKg || !heightCm || !birthDate) return null;

  const age = ageFromBirthDate(birthDate, today);
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + SEX_OFFSET[sex];
  const tdee = bmr * ACTIVITY_FACTOR;

  return Math.round(tdee + GOAL_ADJUSTMENT[goal]);
}
