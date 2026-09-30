import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { MealsRepository } from '@/repositories/food-diary/meals.repository';
import { WaterLogRepository } from '@/repositories/food-diary/waterLog.repository';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { Injectable } from '@nestjs/common';
import { Meal } from '@prisma/client';
import { calculateDailyCalorieGoal } from './calorieGoal.util';
import { CalorieEstimationService } from './calorieEstimation.service';
import {
  parseDateParam,
  startOfDay,
  startOfNextDay,
  subtractDays,
} from './dateRange.util';
import {
  DailySummary,
  LogMealInput,
  MissingProfileField,
  ProfileCompletionInput,
  UpdateMealInput,
} from './foodDiary.types';
import { calculateStreak } from './streak.util';

const NOT_FOUND = 'Refeição não encontrada.';
const BLANK_DESCRIPTION = 'A descrição da refeição é obrigatória.';
const INVALID_CALORIES = 'Informe um valor de calorias válido.';

// How far back the streak's lookback query reaches — a practical cap, not a
// stored value; the streak itself is always computed fresh (ADR/TechSpec).
const STREAK_LOOKBACK_DAYS = 365;

@Injectable()
export class FoodDiaryService {
  constructor(
    private readonly meals: MealsRepository,
    private readonly waterLogs: WaterLogRepository,
    private readonly fitnessProfiles: FitnessProfileRepository,
    private readonly measurementRecords: MeasurementRecordsRepository,
    private readonly users: UserRepository,
    private readonly calorieEstimation: CalorieEstimationService,
  ) {}

  async estimateCalories(description: string): Promise<{ calories: number }> {
    const calories = await this.calorieEstimation.estimate(description);
    return { calories };
  }

  async logMeal(userId: string, input: LogMealInput): Promise<Meal> {
    this.assertValidMeal(input);
    return await this.meals.create(userId, input);
  }

  async updateMeal(
    userId: string,
    mealId: string,
    input: UpdateMealInput,
  ): Promise<Meal> {
    const current = await this.assertOwnedMeal(userId, mealId);
    if (input.description !== undefined || input.calories !== undefined) {
      this.assertValidMeal({
        description: input.description ?? current.description,
        calories: input.calories ?? current.calories,
      });
    }
    return await this.meals.update(mealId, input);
  }

  async deleteMeal(userId: string, mealId: string): Promise<void> {
    await this.assertOwnedMeal(userId, mealId);
    await this.meals.delete(mealId);
  }

  async getDailySummary(userId: string, date: string): Promise<DailySummary> {
    const day = parseDateParam(date);
    const dayStart = startOfDay(day);
    const dayEnd = startOfNextDay(day);
    const streakStart = subtractDays(day, STREAK_LOOKBACK_DAYS);

    const [dayMeals, water, profile, latestMeasurement, user, streakMeals] =
      await Promise.all([
        this.meals.findByUserAndDateRange(userId, dayStart, dayEnd),
        this.waterLogs.findByUserAndDate(userId, day),
        this.fitnessProfiles.findByUserId(userId),
        this.measurementRecords.findLatestByUser(userId),
        this.users.findUnique({ id: userId }),
        this.meals.findByUserAndDateRange(userId, streakStart, dayEnd),
      ]);

    const totalCalories = dayMeals.reduce(
      (sum, meal) => sum + meal.calories,
      0,
    );
    const goal = calculateDailyCalorieGoal(
      {
        sex: profile?.sex,
        goal: profile?.goal,
        weightKg: latestMeasurement?.weightKg,
        heightCm: latestMeasurement?.heightCm,
        birthDate: user?.birthDate,
      },
      day,
    );
    const streak = calculateStreak(
      streakMeals.map((meal) => meal.loggedAt),
      day,
    );

    return {
      meals: dayMeals,
      totalCalories,
      goal,
      waterCount: water?.count ?? 0,
      streak,
    };
  }

  async incrementWater(
    userId: string,
    date: string,
  ): Promise<{ count: number }> {
    const log = await this.waterLogs.increment(userId, parseDateParam(date));
    return { count: log.count };
  }

  async decrementWater(
    userId: string,
    date: string,
  ): Promise<{ count: number }> {
    const log = await this.waterLogs.decrement(userId, parseDateParam(date));
    return { count: log.count };
  }

  // Only FitnessProfile fields — weight/height live on MeasurementRecord
  // and are checked separately by getDailySummary's goal computation.
  async getMissingProfileFields(
    userId: string,
  ): Promise<MissingProfileField[]> {
    const profile = await this.fitnessProfiles.findByUserId(userId);
    const missing: MissingProfileField[] = [];
    if (!profile?.sex) missing.push('sex');
    if (!profile?.goal) missing.push('goal');
    return missing;
  }

  async completeProfile(
    userId: string,
    input: ProfileCompletionInput,
  ): Promise<void> {
    const { sex, goal, weightKg, heightCm } = input;

    if (sex !== undefined || goal !== undefined) {
      await this.fitnessProfiles.upsert(userId, {
        ...(sex !== undefined ? { sex } : {}),
        ...(goal !== undefined ? { goal } : {}),
      });
    }

    // Writes a real MeasurementRecord — never a diary-local field — so this
    // is the exact same data the Progress module and the AI Workout
    // Generator's goal calculation already read.
    if (weightKg !== undefined && heightCm !== undefined) {
      await this.measurementRecords.create(userId, { weightKg, heightCm });
    }
  }

  private assertValidMeal(input: {
    description?: string | null;
    calories?: number | null;
  }): void {
    if (!input.description?.trim()) {
      throw new AppError(BLANK_DESCRIPTION, 400);
    }
    if (
      input.calories === undefined ||
      input.calories === null ||
      input.calories <= 0
    ) {
      throw new AppError(INVALID_CALORIES, 400);
    }
  }

  private async assertOwnedMeal(userId: string, mealId: string): Promise<Meal> {
    const meal = await this.meals.findById(mealId);
    if (!meal || meal.userId !== userId) {
      throw new AppError(NOT_FOUND, 404);
    }
    return meal;
  }
}
