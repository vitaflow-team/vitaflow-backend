import { CodedError } from '@/common/errors/codedError';
import {
  MealInput,
  MealPlansRepository,
  MealPlanWithDays,
} from '@/repositories/meal-plans/mealPlans.repository';
import { Injectable } from '@nestjs/common';
import { Weekday } from '@prisma/client';
import {
  MealPlanDraftResponseDTO,
  MealPlanVersionResponseDTO,
} from './dto/mealPlanResponse.Dto';
import { MEAL_TEXT_MAX_LENGTH } from './mealPlanLimits.constants';
import { sortByWeekday } from './weekdayOrder';

const DRAFT_NOT_FOUND = 'Rascunho de plano alimentar não encontrado.';
const EMPTY_PLAN = 'Defina ao menos uma refeição antes de publicar.';
const VERSION_NOT_FOUND = 'Versão do plano alimentar não encontrada.';
const SOURCE_DAY_NOT_FOUND = 'Dia de origem não encontrado.';
const SOURCE_DAY_FOREIGN = 'O dia de origem pertence a outro paciente.';
const MEAL_TEXT_TOO_LONG = `O texto da refeição deve ter no máximo ${MEAL_TEXT_MAX_LENGTH} caracteres.`;

export interface DayInput {
  weekday: Weekday;
  meals: MealInput[];
}

export function toMealPlanDraftView(
  plan: MealPlanWithDays,
): MealPlanDraftResponseDTO {
  return {
    id: plan.id,
    days: sortByWeekday(plan.days).map((day) => ({
      id: day.id,
      weekday: day.weekday,
      meals: day.meals.map((meal) => ({
        id: meal.id,
        label: meal.label,
        text: meal.text,
      })),
    })),
  };
}

@Injectable()
export class MealPlansService {
  constructor(private readonly mealPlans: MealPlansRepository) {}

  // Pre-filled from the latest PUBLISHED version's days/meals (empty if none
  // exists yet) — ADR-013. Idempotent: a second call for the same client
  // returns the same draft, never creates a duplicate (enforced by Task 1's
  // partial unique index too).
  async getOrCreateDraft(clientId: string): Promise<MealPlanDraftResponseDTO> {
    const existing = await this.mealPlans.findDraftByClient(clientId);
    if (existing) return toMealPlanDraftView(existing);

    const latest = await this.mealPlans.findLatestPublished(clientId);
    const seedDays = latest
      ? latest.days.map((day) => ({
          weekday: day.weekday,
          meals: day.meals.map((meal) => ({
            label: meal.label,
            text: meal.text,
          })),
        }))
      : [];

    const created = await this.mealPlans.createDraft(clientId, seedDays);
    return toMealPlanDraftView(created);
  }

  async saveDay(
    draftId: string,
    day: DayInput,
  ): Promise<MealPlanDraftResponseDTO> {
    await this.requireDraft(draftId);
    this.assertValidMeals(day.meals);
    const updated = await this.mealPlans.replaceDayMeals(
      draftId,
      day.weekday,
      day.meals,
    );
    return toMealPlanDraftView(updated);
  }

  // The source may be a day in this same draft or a day from any past
  // PUBLISHED version of the same client (ADR-006/013) — never a different
  // client's day. Overwrites the target day's meals unconditionally; the
  // "confirm before overwriting existing content" step is an API-boundary
  // concern (task_04.md), not this method's own contract.
  async cloneDay(
    draftId: string,
    sourceDayId: string,
    targetWeekday: Weekday,
  ): Promise<MealPlanDraftResponseDTO> {
    const draft = await this.requireDraft(draftId);

    const source = await this.mealPlans.findDayWithClient(sourceDayId);
    if (!source) {
      throw new CodedError(SOURCE_DAY_NOT_FOUND, 404, 'source_day_not_found');
    }
    if (source.mealPlan.clientId !== draft.clientId) {
      throw new CodedError(SOURCE_DAY_FOREIGN, 403, 'source_day_foreign');
    }

    const meals: MealInput[] = source.meals.map((meal) => ({
      label: meal.label,
      text: meal.text,
    }));
    const updated = await this.mealPlans.replaceDayMeals(
      draftId,
      targetWeekday,
      meals,
    );
    return toMealPlanDraftView(updated);
  }

  async publish(draftId: string): Promise<MealPlanVersionResponseDTO> {
    const draft = await this.requireDraft(draftId);
    const hasAnyMeal = draft.days.some((day) => day.meals.length > 0);
    if (!hasAnyMeal) {
      throw new CodedError(EMPTY_PLAN, 400, 'empty_plan');
    }

    const result = await this.mealPlans.publish(draftId);
    if (!result) {
      throw new CodedError(DRAFT_NOT_FOUND, 404, 'meal_plan_draft_not_found');
    }
    return {
      version: result.version,
      publishedAt: result.publishedAt.toISOString(),
    };
  }

  async listVersions(clientId: string): Promise<MealPlanVersionResponseDTO[]> {
    const versions = await this.mealPlans.listVersions(clientId);
    return versions.map((v) => ({
      version: v.version,
      publishedAt: v.publishedAt.toISOString(),
    }));
  }

  async getVersion(
    clientId: string,
    version: number,
  ): Promise<MealPlanDraftResponseDTO> {
    const plan = await this.requirePublishedVersion(clientId, version);
    return toMealPlanDraftView(plan);
  }

  // Same lookup as getVersion(), but keeps publishedAt — needed by callers
  // (e.g. the patient mirror) that display a single version's publish date
  // without a second round trip through listVersions().
  async getPublishedVersion(
    clientId: string,
    version: number,
  ): Promise<{ publishedAt: string; days: MealPlanDraftResponseDTO['days'] }> {
    const plan = await this.requirePublishedVersion(clientId, version);
    return {
      publishedAt: plan.publishedAt!.toISOString(),
      days: toMealPlanDraftView(plan).days,
    };
  }

  private async requirePublishedVersion(
    clientId: string,
    version: number,
  ): Promise<MealPlanWithDays> {
    const plan = await this.mealPlans.findPublishedByVersion(clientId, version);
    if (!plan) {
      throw new CodedError(
        VERSION_NOT_FOUND,
        404,
        'meal_plan_version_not_found',
      );
    }
    return plan;
  }

  private assertValidMeals(meals: MealInput[]): void {
    for (const meal of meals) {
      if (meal.text.length > MEAL_TEXT_MAX_LENGTH) {
        throw new CodedError(MEAL_TEXT_TOO_LONG, 400, 'meal_text_too_long');
      }
    }
  }

  private async requireDraft(draftId: string): Promise<MealPlanWithDays> {
    const draft = await this.mealPlans.findById(draftId);
    if (!draft || draft.status !== 'DRAFT') {
      throw new CodedError(DRAFT_NOT_FOUND, 404, 'meal_plan_draft_not_found');
    }
    return draft;
  }
}
