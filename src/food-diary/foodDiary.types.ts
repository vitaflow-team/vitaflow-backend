import { FitnessGoal, Meal, MealType, Sex } from '@prisma/client';

export interface LogMealInput {
  mealType: MealType;
  description: string;
  calories: number;
}

export type UpdateMealInput = Partial<LogMealInput>;

export interface DailySummary {
  meals: Meal[];
  totalCalories: number;
  goal: number | null;
  waterCount: number;
  streak: number;
}

export interface ProfileCompletionInput {
  sex?: Sex;
  goal?: FitnessGoal;
  weightKg?: number;
  heightCm?: number;
}

export type MissingProfileField = 'sex' | 'goal';
