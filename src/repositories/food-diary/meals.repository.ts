import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { Meal, MealType } from '@prisma/client';

export interface MealInput {
  mealType: MealType;
  description: string;
  calories: number;
  loggedAt?: Date;
}

export type MealUpdateInput = Partial<MealInput>;

@Injectable()
export class MealsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, data: MealInput): Promise<Meal> {
    return await this.prisma.meal.create({ data: { ...data, userId } });
  }

  async findById(id: string): Promise<Meal | null> {
    return await this.prisma.meal.findUnique({ where: { id } });
  }

  async findByUserAndDateRange(
    userId: string,
    start: Date,
    end: Date,
  ): Promise<Meal[]> {
    return await this.prisma.meal.findMany({
      where: { userId, loggedAt: { gte: start, lt: end } },
      orderBy: { loggedAt: 'asc' },
    });
  }

  async update(id: string, data: MealUpdateInput): Promise<Meal> {
    return await this.prisma.meal.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.meal.delete({ where: { id } });
  }
}
