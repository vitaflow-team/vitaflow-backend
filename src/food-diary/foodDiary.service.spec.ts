import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { MealsRepository } from '@/repositories/food-diary/meals.repository';
import { WaterLogRepository } from '@/repositories/food-diary/waterLog.repository';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { Test, TestingModule } from '@nestjs/testing';
import { FitnessProfile, Meal, MeasurementRecord, Users } from '@prisma/client';
import { CalorieEstimationService } from './calorieEstimation.service';
import { FoodDiaryService } from './foodDiary.service';

function makeMeal(overrides: Partial<Meal> = {}): Meal {
  const timestamp = new Date('2026-09-30T12:00:00.000Z');
  return {
    id: 'meal-1',
    userId: 'user-1',
    mealType: 'LUNCH',
    description: 'Arroz, feijão e frango',
    calories: 650,
    loggedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<FitnessProfile> = {}): FitnessProfile {
  const timestamp = new Date('2026-09-30T00:00:00.000Z');
  return {
    id: 'profile-1',
    userId: 'user-1',
    sex: 'MALE',
    restrictions: [],
    equipment: null,
    goal: 'MAINTENANCE',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeMeasurement(
  overrides: Partial<MeasurementRecord> = {},
): MeasurementRecord {
  const timestamp = new Date('2026-09-30T00:00:00.000Z');
  return {
    id: 'record-1',
    userId: 'user-1',
    weightKg: 80,
    heightCm: 180,
    waistCm: null,
    hipCm: null,
    recordedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeUser(overrides: Partial<Users> = {}): Users {
  const timestamp = new Date('2026-09-30T00:00:00.000Z');
  return {
    id: 'user-1',
    name: 'Usuária',
    email: 'user@example.com',
    password: 'hash',
    avatar: null,
    active: true,
    phone: null,
    birthDate: new Date('1996-01-15'),
    productId: null,
    termsAcceptedAt: timestamp,
    healthDataConsentAt: timestamp,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    subscriptionCancelAt: null,
    subscriptionCurrentPeriodEnd: null,
    isBackoffice: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('FoodDiaryService', () => {
  const mealsCreate = jest.fn();
  const mealsFindById = jest.fn();
  const mealsFindByUserAndDateRange = jest.fn();
  const mealsUpdate = jest.fn();
  const mealsDelete = jest.fn();
  const waterFindByUserAndDate = jest.fn();
  const waterIncrement = jest.fn();
  const waterDecrement = jest.fn();
  const profileFindByUserId = jest.fn();
  const profileUpsert = jest.fn();
  const measurementFindLatestByUser = jest.fn();
  const measurementCreate = jest.fn();
  const userFindUnique = jest.fn();
  const estimate = jest.fn();

  let service: FoodDiaryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FoodDiaryService,
        {
          provide: MealsRepository,
          useValue: {
            create: mealsCreate,
            findById: mealsFindById,
            findByUserAndDateRange: mealsFindByUserAndDateRange,
            update: mealsUpdate,
            delete: mealsDelete,
          },
        },
        {
          provide: WaterLogRepository,
          useValue: {
            findByUserAndDate: waterFindByUserAndDate,
            increment: waterIncrement,
            decrement: waterDecrement,
          },
        },
        {
          provide: FitnessProfileRepository,
          useValue: {
            findByUserId: profileFindByUserId,
            upsert: profileUpsert,
          },
        },
        {
          provide: MeasurementRecordsRepository,
          useValue: {
            findLatestByUser: measurementFindLatestByUser,
            create: measurementCreate,
          },
        },
        { provide: UserRepository, useValue: { findUnique: userFindUnique } },
        { provide: CalorieEstimationService, useValue: { estimate } },
      ],
    }).compile();
    service = module.get(FoodDiaryService);

    profileFindByUserId.mockResolvedValue(null);
    measurementFindLatestByUser.mockResolvedValue(null);
    userFindUnique.mockResolvedValue(makeUser());
    waterFindByUserAndDate.mockResolvedValue(null);
    mealsFindByUserAndDateRange.mockResolvedValue([]);
  });

  describe('estimateCalories', () => {
    it('UT-002 returns a best-effort number for a vague description', async () => {
      estimate.mockResolvedValue(300);

      await expect(service.estimateCalories('comida')).resolves.toEqual({
        calories: 300,
      });
    });
  });

  describe('logMeal', () => {
    it('UT-003 rejects a blank description without creating a Meal', async () => {
      await expect(
        service.logMeal('user-1', {
          mealType: 'LUNCH',
          description: '   ',
          calories: 500,
        }),
      ).rejects.toBeInstanceOf(AppError);
      expect(mealsCreate).not.toHaveBeenCalled();
    });

    it('UT-005 creates a separate row each time, even with an identical description', async () => {
      mealsCreate.mockResolvedValue(makeMeal());

      await service.logMeal('user-1', {
        mealType: 'LUNCH',
        description: 'Arroz e feijão',
        calories: 500,
      });
      await service.logMeal('user-1', {
        mealType: 'LUNCH',
        description: 'Arroz e feijão',
        calories: 500,
      });

      expect(mealsCreate).toHaveBeenCalledTimes(2);
    });

    it('UT-006 persists the user-edited calorie value, not a re-fetched estimate', async () => {
      mealsCreate.mockResolvedValue(makeMeal({ calories: 450 }));

      await service.logMeal('user-1', {
        mealType: 'DINNER',
        description: 'Sopa',
        calories: 450,
      });

      expect(mealsCreate).toHaveBeenCalledWith('user-1', {
        mealType: 'DINNER',
        description: 'Sopa',
        calories: 450,
      });
      expect(estimate).not.toHaveBeenCalled();
    });

    it('UT-007 rejects a negative calorie value', async () => {
      await expect(
        service.logMeal('user-1', {
          mealType: 'LUNCH',
          description: 'x',
          calories: -10,
        }),
      ).rejects.toBeInstanceOf(AppError);
      expect(mealsCreate).not.toHaveBeenCalled();
    });

    it('UT-008 rejects a null calorie value', async () => {
      await expect(
        service.logMeal('user-1', {
          mealType: 'LUNCH',
          description: 'x',

          calories: null as any,
        }),
      ).rejects.toBeInstanceOf(AppError);
      expect(mealsCreate).not.toHaveBeenCalled();
    });
  });

  describe('updateMeal / deleteMeal', () => {
    it('UT-017 updates a meal owned by the user', async () => {
      mealsFindById.mockResolvedValue(makeMeal());
      mealsUpdate.mockResolvedValue(makeMeal({ calories: 700 }));

      const result = await service.updateMeal('user-1', 'meal-1', {
        calories: 700,
      });

      expect(mealsUpdate).toHaveBeenCalledWith('meal-1', { calories: 700 });
      expect(result.calories).toBe(700);
    });

    it('UT-018 deletes a meal owned by the user', async () => {
      mealsFindById.mockResolvedValue(makeMeal());

      await service.deleteMeal('user-1', 'meal-1');

      expect(mealsDelete).toHaveBeenCalledWith('meal-1');
    });

    it('UT-019 refuses to update a meal owned by a different user', async () => {
      mealsFindById.mockResolvedValue(makeMeal({ userId: 'other-user' }));

      await expect(
        service.updateMeal('user-1', 'meal-1', { calories: 700 }),
      ).rejects.toMatchObject({ message: 'Refeição não encontrada.' });
      expect(mealsUpdate).not.toHaveBeenCalled();
    });

    it('UT-019 refuses to delete a meal owned by a different user', async () => {
      mealsFindById.mockResolvedValue(makeMeal({ userId: 'other-user' }));

      await expect(
        service.deleteMeal('user-1', 'meal-1'),
      ).rejects.toBeInstanceOf(AppError);
      expect(mealsDelete).not.toHaveBeenCalled();
    });

    it('UT-019 refuses to edit/delete a meal that does not exist at all', async () => {
      mealsFindById.mockResolvedValue(null);

      await expect(
        service.updateMeal('user-1', 'missing', { calories: 700 }),
      ).rejects.toMatchObject({ message: 'Refeição não encontrada.' });
    });
  });

  describe('getDailySummary', () => {
    it('UT-009 returns 3 meals with a correctly summed total', async () => {
      mealsFindByUserAndDateRange.mockResolvedValue([
        makeMeal({ id: 'm1', calories: 300 }),
        makeMeal({ id: 'm2', calories: 400 }),
        makeMeal({ id: 'm3', calories: 350 }),
      ]);

      const result = await service.getDailySummary('user-1', '2026-09-30');

      expect(result.meals).toHaveLength(3);
      expect(result.totalCalories).toBe(1050);
    });

    it('UT-010 returns all 25 meals with the correct total, no truncation', async () => {
      const meals = Array.from({ length: 25 }, (_, index) =>
        makeMeal({ id: `m${index}`, calories: 100 }),
      );
      mealsFindByUserAndDateRange.mockResolvedValue(meals);

      const result = await service.getDailySummary('user-1', '2026-09-30');

      expect(result.meals).toHaveLength(25);
      expect(result.totalCalories).toBe(2500);
    });

    it('UT-011 returns an empty list and total 0 for a past day with no entries', async () => {
      mealsFindByUserAndDateRange.mockResolvedValue([]);

      const result = await service.getDailySummary('user-1', '2020-01-01');

      expect(result.meals).toEqual([]);
      expect(result.totalCalories).toBe(0);
    });

    it('UT-012/UT-013 reflects a fresh MeasurementRecord/FitnessProfile on every call, never stale', async () => {
      profileFindByUserId.mockResolvedValue(
        makeProfile({ goal: 'MAINTENANCE' }),
      );
      measurementFindLatestByUser.mockResolvedValue(makeMeasurement());

      const first = await service.getDailySummary('user-1', '2026-09-30');

      profileFindByUserId.mockResolvedValue(
        makeProfile({ goal: 'WEIGHT_LOSS' }),
      );
      const second = await service.getDailySummary('user-1', '2026-09-30');

      expect(first.goal).not.toBe(second.goal);
      expect(second.goal).toBe((first.goal as number) - 500);
    });

    it('UT-015 returns goal: null when profile fields are missing, meals/total still populate', async () => {
      profileFindByUserId.mockResolvedValue(null);
      measurementFindLatestByUser.mockResolvedValue(null);
      mealsFindByUserAndDateRange.mockResolvedValue([
        makeMeal({ calories: 500 }),
      ]);

      const result = await service.getDailySummary('user-1', '2026-09-30');

      expect(result.goal).toBeNull();
      expect(result.totalCalories).toBe(500);
      expect(result.meals).toHaveLength(1);
    });
  });

  describe('water', () => {
    it('UT-021 increments the water count for a date', async () => {
      waterIncrement.mockResolvedValue({ count: 1 });

      await expect(
        service.incrementWater('user-1', '2026-09-30'),
      ).resolves.toEqual({ count: 1 });
      expect(waterIncrement).toHaveBeenCalledTimes(1);
    });

    it('UT-022 maps each rapid call 1:1 to the repository, none dropped', async () => {
      waterIncrement.mockResolvedValue({ count: 1 });

      await Promise.all(
        Array.from({ length: 5 }, () =>
          service.incrementWater('user-1', '2026-09-30'),
        ),
      );

      expect(waterIncrement).toHaveBeenCalledTimes(5);
    });

    it('UT-023 decrementing floors at 0 (delegated to the repository)', async () => {
      waterDecrement.mockResolvedValue({ count: 0 });

      await expect(
        service.decrementWater('user-1', '2026-09-30'),
      ).resolves.toEqual({ count: 0 });
    });
  });

  describe('profile completion', () => {
    it('UT-014 returns [sex, goal] when no FitnessProfile exists', async () => {
      profileFindByUserId.mockResolvedValue(null);

      await expect(service.getMissingProfileFields('user-1')).resolves.toEqual([
        'sex',
        'goal',
      ]);
    });

    it('returns only the fields actually missing', async () => {
      profileFindByUserId.mockResolvedValue(
        makeProfile({ sex: 'MALE', goal: null }),
      );

      await expect(service.getMissingProfileFields('user-1')).resolves.toEqual([
        'goal',
      ]);
    });

    it('UT-016 writes weight/height through the completion prompt as a real MeasurementRecord', async () => {
      await service.completeProfile('user-1', { weightKg: 70, heightCm: 170 });

      expect(measurementCreate).toHaveBeenCalledWith('user-1', {
        weightKg: 70,
        heightCm: 170,
      });
    });

    it('writes sex/goal through the completion prompt to the shared FitnessProfile', async () => {
      await service.completeProfile('user-1', {
        sex: 'FEMALE',
        goal: 'MUSCLE_GAIN',
      });

      expect(profileUpsert).toHaveBeenCalledWith('user-1', {
        sex: 'FEMALE',
        goal: 'MUSCLE_GAIN',
      });
    });
  });
});
