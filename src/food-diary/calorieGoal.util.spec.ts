import { calculateDailyCalorieGoal } from './calorieGoal.util';

const TODAY = new Date('2026-09-30T00:00:00.000Z');

describe('calculateDailyCalorieGoal', () => {
  it('UT-012 matches a hand-computed Mifflin-St Jeor result', () => {
    // 30-year-old male, 80kg, 180cm, MUSCLE_GAIN.
    // BMR = 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
    // TDEE = 1780 * 1.55 = 2759
    // + 300 (MUSCLE_GAIN) = 3059
    const result = calculateDailyCalorieGoal(
      {
        sex: 'MALE',
        goal: 'MUSCLE_GAIN',
        weightKg: 80,
        heightCm: 180,
        birthDate: new Date('1996-01-15T00:00:00.000Z'),
      },
      TODAY,
    );

    expect(result).toBe(3059);
  });

  it('applies the WEIGHT_LOSS deficit', () => {
    // 25-year-old female, 65kg, 165cm.
    // BMR = 10*65 + 6.25*165 - 5*25 - 161 = 650 + 1031.25 - 125 - 161 = 1395.25
    // TDEE = 1395.25 * 1.55 = 2162.6375
    // - 500 = 1662.6375 -> rounds to 1663
    const result = calculateDailyCalorieGoal(
      {
        sex: 'FEMALE',
        goal: 'WEIGHT_LOSS',
        weightKg: 65,
        heightCm: 165,
        birthDate: new Date('2001-03-01T00:00:00.000Z'),
      },
      TODAY,
    );

    expect(result).toBe(1663);
  });

  it('applies no adjustment for MAINTENANCE/CONDITIONING', () => {
    const base = {
      sex: 'MALE' as const,
      weightKg: 80,
      heightCm: 180,
      birthDate: new Date('1996-01-15T00:00:00.000Z'),
    };

    const maintenance = calculateDailyCalorieGoal(
      { ...base, goal: 'MAINTENANCE' },
      TODAY,
    );
    const conditioning = calculateDailyCalorieGoal(
      { ...base, goal: 'CONDITIONING' },
      TODAY,
    );

    expect(maintenance).toBe(2759);
    expect(conditioning).toBe(2759);
  });

  it.each([
    [
      'sex',
      {
        sex: undefined,
        goal: 'MAINTENANCE',
        weightKg: 80,
        heightCm: 180,
        birthDate: TODAY,
      },
    ],
    [
      'goal',
      {
        sex: 'MALE',
        goal: undefined,
        weightKg: 80,
        heightCm: 180,
        birthDate: TODAY,
      },
    ],
    [
      'weightKg',
      {
        sex: 'MALE',
        goal: 'MAINTENANCE',
        weightKg: undefined,
        heightCm: 180,
        birthDate: TODAY,
      },
    ],
    [
      'heightCm',
      {
        sex: 'MALE',
        goal: 'MAINTENANCE',
        weightKg: 80,
        heightCm: undefined,
        birthDate: TODAY,
      },
    ],
    [
      'birthDate',
      {
        sex: 'MALE',
        goal: 'MAINTENANCE',
        weightKg: 80,
        heightCm: 180,
        birthDate: undefined,
      },
    ],
  ])(
    'returns null when %s is missing, never a guessed default',
    (_field, input) => {
      expect(calculateDailyCalorieGoal(input as any, TODAY)).toBeNull();
    },
  );
});
