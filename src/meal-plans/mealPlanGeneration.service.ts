import { ConversationStore } from '@/common/conversation/conversationStore';
import { ClientNutritionProfileRepository } from '@/repositories/meal-plans/clientNutritionProfile.repository';
import { MealPlansRepository } from '@/repositories/meal-plans/mealPlans.repository';
import { AppError } from '@/utils/app.erro';
import { Injectable, Logger } from '@nestjs/common';
import { ClientNutritionProfile } from '@prisma/client';
import { MealPlanDraftResponseDTO } from './dto/mealPlanResponse.Dto';
import {
  MEALS_PER_DAY_MAX,
  MEALS_PER_DAY_MIN,
  TARGET_CALORIES_MAX,
  TARGET_CALORIES_MIN,
} from './mealPlanLimits.constants';
import { toMealPlanDraftView } from './mealPlans.service';
import {
  MealPlanConversationResult,
  MealPlanConversationTurnResult,
  MealPlanIntakeAnswers,
  MealPlanIntakeField,
  MealPlanOrchestrationState,
} from './mealPlanConversation.types';
import {
  MealPlanConversationTurn,
  MealPlanLlmService,
} from './mealPlanLlm.service';

const CONVERSATION_NOT_FOUND = 'Conversa não encontrada ou expirada.';
const DRAFT_NOT_FOUND =
  'Rascunho de plano alimentar não encontrado para este paciente.';
const MEALS_PER_DAY_QUESTION =
  'Quantas refeições por dia o paciente deve fazer?';
const TARGET_CALORIES_QUESTION_BASE =
  'Qual é a meta de calorias diárias? (opcional — deixe em branco para pular)';

interface ConversationStepInput {
  professionalId: string;
  conversationId: string;
  state: MealPlanOrchestrationState;
  rawAnswer: string;
}

// Orchestrates the meal-plan AI-generation conversation (TechSpec Core
// Interfaces): deterministic fields (`mealsPerDay`, `targetCalories`)
// parsed/validated directly here, mirroring `WorkoutsService`'s
// `parseRangedInt` style; LLM-driven fields (`goal`, `restrictions`) handed
// to `MealPlanLlmService.nextQuestion`. On completion, calls `generatePlan`,
// writes via `MealPlansRepository.replaceAllDaysMeals` in one call, and
// upserts `ClientNutritionProfile`.
@Injectable()
export class MealPlanGenerationService {
  private readonly logger = new Logger(MealPlanGenerationService.name);

  constructor(
    private readonly profiles: ClientNutritionProfileRepository,
    private readonly llm: MealPlanLlmService,
    private readonly mealPlans: MealPlansRepository,
    private readonly conversations: ConversationStore<MealPlanOrchestrationState>,
  ) {}

  // Confirm-overwrite is checked by the controller before this is ever
  // called (ADR-013) — this method always starts a fresh intake.
  async startConversation(
    clientId: string,
    professionalId: string,
  ): Promise<MealPlanConversationResult> {
    const profile = await this.profiles.findByClientId(clientId);
    const state: MealPlanOrchestrationState = {
      clientId,
      answers: {},
      pendingField: null,
      prefill: toPrefill(profile),
    };
    const conversationId = this.conversations.create(professionalId, state);

    return await this.advance({ professionalId, conversationId, state });
  }

  async answer(
    professionalId: string,
    conversationId: string,
    rawAnswer: string,
  ): Promise<MealPlanConversationResult> {
    const state = this.conversations.get(professionalId, conversationId);
    if (!state) throw new AppError(CONVERSATION_NOT_FOUND, 404);

    const input: ConversationStepInput = {
      professionalId,
      conversationId,
      state,
      rawAnswer,
    };

    if (state.pendingField === 'targetCalories') {
      return await this.answerTargetCalories(input);
    }
    if (state.pendingField === 'mealsPerDay') {
      return await this.answerMealsPerDay(input);
    }
    return await this.answerLlmField(input);
  }

  // Walks the fixed field order (PRD US-001.AC-1): goal, restrictions
  // (LLM-driven) first, then targetCalories, mealsPerDay (deterministic),
  // then completes. Called right after `startConversation` and after every
  // deterministic/LLM step resolves — mirrors `WorkoutsService.advance`.
  private async advance(input: {
    professionalId: string;
    conversationId: string;
    state: MealPlanOrchestrationState;
  }): Promise<MealPlanConversationResult> {
    const { professionalId, conversationId, state } = input;
    const { answers } = state;

    if (answers.goal === undefined || answers.restrictions === undefined) {
      return await this.advanceLlm(professionalId, conversationId, state);
    }
    if (answers.targetCalories === undefined) {
      return this.askDeterministic({
        conversationId,
        state,
        field: 'targetCalories',
        question: targetCaloriesQuestion(state.prefill.targetCalories),
        optional: true,
      });
    }
    if (answers.mealsPerDay === undefined) {
      return this.askDeterministic({
        conversationId,
        state,
        field: 'mealsPerDay',
        question: mealsPerDayQuestion(state.prefill.mealsPerDay),
      });
    }

    return await this.completeConversation(
      professionalId,
      conversationId,
      state,
    );
  }

  // Asks the first still-unknown LLM-driven field (goal or restrictions),
  // with no raw answer to parse yet.
  private async advanceLlm(
    professionalId: string,
    conversationId: string,
    state: MealPlanOrchestrationState,
  ): Promise<MealPlanConversationResult> {
    const turn = await this.llm.nextQuestion({
      answers: pickLlmAnswers(state.answers),
      previousAnswers: pickLlmAnswers(state.prefill),
    });
    return await this.resolveLlmTurn(
      professionalId,
      conversationId,
      state,
      turn,
    );
  }

  private async answerLlmField(
    input: ConversationStepInput,
  ): Promise<MealPlanConversationResult> {
    const { professionalId, conversationId, state, rawAnswer } = input;
    const turn = await this.llm.nextQuestion({
      answers: pickLlmAnswers(state.answers),
      previousAnswers: pickLlmAnswers(state.prefill),
      pendingField: state.pendingField as 'goal' | 'restrictions' | undefined,
      pendingRawAnswer: rawAnswer,
    });
    return await this.resolveLlmTurn(
      professionalId,
      conversationId,
      state,
      turn,
    );
  }

  // Shared by the first LLM question (`advanceLlm`) and every subsequent
  // one (`answerLlmField`): merges the LLM's merged answers into state,
  // then either reprompts, moves past the LLM phase via `advance` once
  // both fields are known, or asks the LLM's next field.
  private async resolveLlmTurn(
    professionalId: string,
    conversationId: string,
    state: MealPlanOrchestrationState,
    turn: MealPlanConversationTurn,
  ): Promise<MealPlanConversationResult> {
    const mergedAnswers = { ...state.answers, ...turn.answers };

    if (turn.reprompt) {
      this.conversations.update(conversationId, {
        ...state,
        answers: mergedAnswers,
      });
      return this.toTurnResult({
        conversationId,
        field: turn.field,
        question: turn.question,
        done: false,
        reprompt: true,
      });
    }

    if (turn.done) {
      return await this.advance({
        professionalId,
        conversationId,
        state: { ...state, answers: mergedAnswers, pendingField: null },
      });
    }

    this.conversations.update(conversationId, {
      ...state,
      answers: mergedAnswers,
      pendingField: turn.field,
    });
    return this.toTurnResult({
      conversationId,
      field: turn.field,
      question: turn.question,
      done: false,
      reprompt: false,
    });
  }

  // Optional field (US-001.AC-2): an empty answer is a valid skip,
  // persisted as `null`, distinct from `undefined` ("not yet asked").
  private async answerTargetCalories(
    input: ConversationStepInput,
  ): Promise<MealPlanConversationResult> {
    const { professionalId, conversationId, state, rawAnswer } = input;
    const trimmed = rawAnswer.trim();
    if (trimmed.length === 0) {
      return await this.advanceWithAnswer(
        professionalId,
        conversationId,
        state,
        {
          targetCalories: null,
        },
      );
    }

    const value = parseRangedInt(
      trimmed,
      TARGET_CALORIES_MIN,
      TARGET_CALORIES_MAX,
    );
    if (value === null) {
      return this.repromptTurn({
        conversationId,
        field: 'targetCalories',
        question: targetCaloriesQuestion(state.prefill.targetCalories),
        optional: true,
      });
    }
    return await this.advanceWithAnswer(professionalId, conversationId, state, {
      targetCalories: value,
    });
  }

  private async answerMealsPerDay(
    input: ConversationStepInput,
  ): Promise<MealPlanConversationResult> {
    const { professionalId, conversationId, state, rawAnswer } = input;
    const value = parseRangedInt(
      rawAnswer,
      MEALS_PER_DAY_MIN,
      MEALS_PER_DAY_MAX,
    );
    if (value === null) {
      return this.repromptTurn({
        conversationId,
        field: 'mealsPerDay',
        question: mealsPerDayQuestion(state.prefill.mealsPerDay),
      });
    }
    return await this.advanceWithAnswer(professionalId, conversationId, state, {
      mealsPerDay: value,
    });
  }

  private async advanceWithAnswer(
    professionalId: string,
    conversationId: string,
    state: MealPlanOrchestrationState,
    patch: Partial<MealPlanIntakeAnswers>,
  ): Promise<MealPlanConversationResult> {
    return await this.advance({
      professionalId,
      conversationId,
      state: {
        ...state,
        answers: { ...state.answers, ...patch },
        pendingField: null,
      },
    });
  }

  private askDeterministic(input: {
    conversationId: string;
    state: MealPlanOrchestrationState;
    field: MealPlanIntakeField;
    question: string;
    optional?: boolean;
  }): MealPlanConversationTurnResult {
    const { conversationId, state, field, question, optional = false } = input;
    this.conversations.update(conversationId, {
      ...state,
      pendingField: field,
    });
    return this.toTurnResult({
      conversationId,
      field,
      question,
      done: false,
      reprompt: false,
      optional,
    });
  }

  private repromptTurn(input: {
    conversationId: string;
    field: MealPlanIntakeField;
    question: string;
    optional?: boolean;
  }): MealPlanConversationTurnResult {
    const { conversationId, field, question, optional = false } = input;
    return this.toTurnResult({
      conversationId,
      field,
      question,
      done: false,
      reprompt: true,
      optional,
    });
  }

  private toTurnResult(input: {
    conversationId: string;
    field: MealPlanIntakeField | null;
    question: string;
    done: boolean;
    reprompt: boolean;
    optional?: boolean;
  }): MealPlanConversationTurnResult {
    return {
      conversationId: input.conversationId,
      field: input.field,
      question: input.question,
      done: input.done,
      reprompt: input.reprompt,
      optional: input.optional ?? false,
    };
  }

  // Every field is known once this runs (TechSpec full-week atomicity
  // rule) — a failed `generatePlan` call throws before any write happens
  // (UT-018), leaving the draft (and the profile) completely untouched.
  private async completeConversation(
    professionalId: string,
    conversationId: string,
    state: MealPlanOrchestrationState,
  ): Promise<MealPlanDraftResponseDTO> {
    this.conversations.delete(conversationId);
    const answers = state.answers as MealPlanIntakeAnswers;

    const generatedDays = await this.llm.generatePlan(answers);

    const draft = await this.mealPlans.findDraftByClient(state.clientId);
    if (!draft)
      throw new AppError(DRAFT_NOT_FOUND, 404, 'meal_plan_draft_not_found');

    const updated = await this.mealPlans.replaceAllDaysMeals(
      draft.id,
      generatedDays.map((day) => ({ weekday: day.weekday, meals: day.meals })),
    );

    await this.profiles.upsert(state.clientId, {
      goal: answers.goal,
      restrictions: answers.restrictions,
      targetCalories: answers.targetCalories,
      mealsPerDay: answers.mealsPerDay,
    });

    this.logger.log(
      `meal_plan_generated clientId=${state.clientId} professionalId=${professionalId}`,
    );

    return toMealPlanDraftView(updated);
  }
}

function pickLlmAnswers(
  answers: Partial<MealPlanIntakeAnswers>,
): Partial<Pick<MealPlanIntakeAnswers, 'goal' | 'restrictions'>> {
  return { goal: answers.goal, restrictions: answers.restrictions };
}

// Previously confirmed values for this client (ADR-007) — shown as a hint
// only; never copied into `answers` (ADR-006/US-003, UT-022).
function toPrefill(
  profile: ClientNutritionProfile | null,
): Partial<MealPlanIntakeAnswers> {
  if (!profile) return {};
  return {
    goal: profile.goal,
    restrictions: profile.restrictions,
    targetCalories: profile.targetCalories,
    mealsPerDay: profile.mealsPerDay,
  };
}

function targetCaloriesQuestion(previous: number | null | undefined): string {
  if (previous === undefined) return TARGET_CALORIES_QUESTION_BASE;
  const hint =
    previous === null
      ? 'sem meta definida anteriormente'
      : `${previous} kcal anteriormente`;
  return `${TARGET_CALORIES_QUESTION_BASE} (${hint})`;
}

function mealsPerDayQuestion(previous: number | undefined): string {
  if (previous === undefined) return MEALS_PER_DAY_QUESTION;
  return `${MEALS_PER_DAY_QUESTION} (${previous} anteriormente)`;
}

function parseRangedInt(
  rawAnswer: string,
  min: number,
  max: number,
): number | null {
  const trimmed = rawAnswer.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (value < min || value > max) return null;
  return value;
}
