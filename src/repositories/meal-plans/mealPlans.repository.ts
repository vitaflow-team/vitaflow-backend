import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import {
  MealPlan,
  MealPlanDay,
  MealPlanMeal,
  MealPlanStatus,
  Weekday,
} from '@prisma/client';

export type MealPlanWithDays = MealPlan & {
  days: Array<MealPlanDay & { meals: MealPlanMeal[] }>;
};

export type MealPlanDayWithMeals = MealPlanDay & {
  meals: MealPlanMeal[];
  mealPlan: { clientId: string };
};

export interface MealInput {
  label: string;
  text: string;
}

const INCLUDE_DAYS_AND_MEALS = {
  days: { include: { meals: { orderBy: { position: 'asc' as const } } } },
};

@Injectable()
export class MealPlansRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<MealPlanWithDays | null> {
    return await this.prisma.mealPlan.findUnique({
      where: { id },
      include: INCLUDE_DAYS_AND_MEALS,
    });
  }

  async findDraftByClient(clientId: string): Promise<MealPlanWithDays | null> {
    return await this.prisma.mealPlan.findFirst({
      where: { clientId, status: MealPlanStatus.DRAFT },
      include: INCLUDE_DAYS_AND_MEALS,
    });
  }

  async findLatestPublished(
    clientId: string,
  ): Promise<MealPlanWithDays | null> {
    return await this.prisma.mealPlan.findFirst({
      where: { clientId, status: MealPlanStatus.PUBLISHED },
      orderBy: { version: 'desc' },
      include: INCLUDE_DAYS_AND_MEALS,
    });
  }

  async findPublishedByVersion(
    clientId: string,
    version: number,
  ): Promise<MealPlanWithDays | null> {
    return await this.prisma.mealPlan.findFirst({
      where: { clientId, status: MealPlanStatus.PUBLISHED, version },
      include: INCLUDE_DAYS_AND_MEALS,
    });
  }

  async listVersions(
    clientId: string,
  ): Promise<Array<{ version: number; publishedAt: Date }>> {
    const rows = await this.prisma.mealPlan.findMany({
      where: { clientId, status: MealPlanStatus.PUBLISHED },
      select: { version: true, publishedAt: true },
      orderBy: { version: 'desc' },
    });
    return rows.map((row) => ({
      version: row.version!,
      publishedAt: row.publishedAt!,
    }));
  }

  // Pre-filled from `seedDays` (the latest published version's content, or
  // empty when none exists yet) — one create, nested days and meals.
  async createDraft(
    clientId: string,
    seedDays: Array<{ weekday: Weekday; meals: MealInput[] }>,
  ): Promise<MealPlanWithDays> {
    return await this.prisma.mealPlan.create({
      data: {
        clientId,
        status: MealPlanStatus.DRAFT,
        days: {
          create: seedDays.map((day) => ({
            weekday: day.weekday,
            meals: {
              create: day.meals.map((meal, position) => ({
                position,
                label: meal.label,
                text: meal.text,
              })),
            },
          })),
        },
      },
      include: INCLUDE_DAYS_AND_MEALS,
    });
  }

  async findDayWithClient(dayId: string): Promise<MealPlanDayWithMeals | null> {
    return await this.prisma.mealPlanDay.findUnique({
      where: { id: dayId },
      include: {
        meals: { orderBy: { position: 'asc' } },
        mealPlan: { select: { clientId: true } },
      },
    });
  }

  // Upserts the day for `weekday` on `mealPlanId` and replaces its whole meal
  // list — the only write path for a draft's children (US-012/US-013).
  async replaceDayMeals(
    mealPlanId: string,
    weekday: Weekday,
    meals: MealInput[],
  ): Promise<MealPlanWithDays> {
    await this.prisma.$transaction(async (tx) => {
      const day = await tx.mealPlanDay.upsert({
        where: { mealPlanId_weekday: { mealPlanId, weekday } },
        create: { mealPlanId, weekday },
        update: {},
      });
      await tx.mealPlanMeal.deleteMany({ where: { dayId: day.id } });
      await tx.mealPlanMeal.createMany({
        data: meals.map((meal, position) => ({
          dayId: day.id,
          position,
          label: meal.label,
          text: meal.text,
        })),
      });
    });
    return (await this.findById(mealPlanId))!;
  }

  // Lock-swap publish (ADR-013), mirroring EducatorWorkout.activate()'s exact
  // shape — except nothing is archived: every PUBLISHED version accumulates.
  // Returns null if the draft no longer exists or is already published
  // (re-checked live, inside the lock, after it is acquired).
  async publish(
    draftId: string,
  ): Promise<{ version: number; publishedAt: Date } | null> {
    const existing = await this.prisma.mealPlan.findUnique({
      where: { id: draftId },
      select: { clientId: true },
    });
    if (!existing) return null;

    return await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${existing.clientId} FOR UPDATE`;

      const target = await tx.mealPlan.findUnique({
        where: { id: draftId },
        select: { status: true, clientId: true },
      });
      if (!target || target.status !== MealPlanStatus.DRAFT) return null;

      const highest = await tx.mealPlan.findFirst({
        where: { clientId: target.clientId, status: MealPlanStatus.PUBLISHED },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (highest?.version ?? 0) + 1;
      const publishedAt = new Date();

      await tx.mealPlan.update({
        where: { id: draftId },
        data: { status: MealPlanStatus.PUBLISHED, version, publishedAt },
      });
      return { version, publishedAt };
    });
  }
}
