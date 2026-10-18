import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import {
  UpdateWorkoutExerciseData,
  WorkoutWithDetails,
  WorkoutsRepository,
} from '@/repositories/workouts/workouts.repository';
import { AppError } from '@/utils/app.erro';
import { Injectable } from '@nestjs/common';
import {
  ExerciseStatus,
  FitnessGoal,
  FitnessProfile,
  MuscleFocus,
} from '@prisma/client';
import { ConversationStore, OrchestrationState } from './conversationStore';
import { isPlanUsable, toWorkoutInput } from './generatedPlan.util';
import {
  ConversationAnswers,
  ConversationField,
  MuscleFocusAnswer,
} from './llmExplanation.types';
import { LlmExplanationService } from './llmExplanation.service';
import { PremiumGuard } from '@/common/guards/premium.guard';
import { RuleEngineService } from './ruleEngine.service';
import { ConversationTurnResult, DeterministicField } from './workouts.types';

const NOT_FOUND = 'Recurso não encontrado.';
const CONVERSATION_NOT_FOUND = 'Conversa não encontrada ou expirada.';
const PREMIUM_REQUIRED = 'Regeneração requer o plano Premium.';
const NOT_ENOUGH_EXERCISES =
  'Não há exercícios suficientes para os critérios informados.';
const EMPTY_DAY = 'Um dia de treino não pode ficar sem exercícios.';
const INVALID_SETS_REPS = 'Sets e reps devem ser valores positivos.';
const CONTRAINDICATED = 'Este exercício é contraindicado para suas restrições.';
const MISSING_DAYS_PER_WEEK = 'Informe quantos dias por semana você treina.';

const AGE_QUESTION = 'Qual é a sua idade?';
const WEIGHT_QUESTION = 'Qual é o seu peso, em kg?';
const HEIGHT_QUESTION = 'Qual é a sua altura, em cm?';
const SESSION_DURATION_QUESTION =
  'Quantos minutos você tem disponível por sessão de treino?';
const RESTRICTION_DETAIL_QUESTION =
  'Quer contar mais detalhes sobre alguma lesão ou restrição? (opcional — pode deixar em branco)';

const MIN_AGE = 10;
const MAX_AGE = 100;
const MIN_WEIGHT_KG = 20;
const MAX_WEIGHT_KG = 300;
const MIN_HEIGHT_CM = 100;
const MAX_HEIGHT_CM = 250;
const MIN_SESSION_DURATION_MIN = 10;
const MAX_SESSION_DURATION_MIN = 180;
const MAX_RESTRICTION_DETAIL_LENGTH = 500;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export interface UpdateWorkoutExerciseInput {
  exerciseId?: string;
  sets?: number;
  reps?: number;
  remove?: boolean;
}

@Injectable()
export class WorkoutsService {
  constructor(
    private readonly fitnessProfiles: FitnessProfileRepository,
    private readonly users: UserRepository,
    private readonly exercises: ExercisesRepository,
    private readonly ruleEngine: RuleEngineService,
    private readonly llm: LlmExplanationService,
    private readonly workouts: WorkoutsRepository,
    private readonly conversations: ConversationStore,
    private readonly premiumGuard: PremiumGuard,
  ) {}

  // No plan-tier check here (US-001 AC-1): every user, Free or Premium,
  // can always start.
  async startConversation(
    userId: string,
  ): Promise<ConversationTurnResult | WorkoutWithDetails> {
    const [profile, user] = await Promise.all([
      this.fitnessProfiles.findByUserId(userId),
      this.users.findUnique({ id: userId }),
    ]);
    if (!user) throw new AppError(NOT_FOUND, 404);

    const state: OrchestrationState = {
      answers: prefillAnswers(profile),
      ageKnown: user.birthDate !== null,
      weightKg: profile?.weightKg ?? undefined,
      heightCm: profile?.heightCm ?? undefined,
      sessionDurationMin: profile?.sessionDurationMin ?? undefined,
      restrictionDetail: profile?.restrictionDetail,
      pendingField: null,
    };
    const conversationId = this.conversations.create(userId, state);

    return await this.advance(userId, conversationId, state);
  }

  async answer(
    userId: string,
    conversationId: string,
    rawAnswer: string,
  ): Promise<ConversationTurnResult | WorkoutWithDetails> {
    const state = this.conversations.get(userId, conversationId);
    if (!state) throw new AppError(CONVERSATION_NOT_FOUND, 404);

    switch (state.pendingField) {
      case 'age':
        return await this.answerAge(userId, conversationId, state, rawAnswer);
      case 'weight':
        return await this.answerWeight(
          userId,
          conversationId,
          state,
          rawAnswer,
        );
      case 'height':
        return await this.answerHeight(
          userId,
          conversationId,
          state,
          rawAnswer,
        );
      case 'sessionDuration':
        return await this.answerSessionDuration(
          userId,
          conversationId,
          state,
          rawAnswer,
        );
      case 'restrictionDetail':
        return await this.answerRestrictionDetail(
          userId,
          conversationId,
          state,
          rawAnswer,
        );
    }

    const turn = await this.llm.nextQuestion({
      answers: state.answers,
      pendingField: state.pendingField as ConversationField | undefined,
      pendingRawAnswer: rawAnswer,
    });

    if (turn.reprompt) {
      this.conversations.update(conversationId, {
        ...state,
        answers: turn.answers,
      });
      return {
        conversationId,
        field: turn.field,
        question: turn.question,
        done: false,
        reprompt: true,
        optional: false,
      };
    }

    if (turn.done) {
      return await this.advanceAfterLlm(userId, conversationId, {
        ...state,
        answers: turn.answers,
      });
    }

    this.conversations.update(conversationId, {
      ...state,
      answers: turn.answers,
      pendingField: turn.field,
    });
    return {
      conversationId,
      field: turn.field,
      question: turn.question,
      done: false,
      reprompt: false,
      optional: false,
    };
  }

  async getCurrent(userId: string): Promise<WorkoutWithDetails | null> {
    return await this.workouts.findCurrentByUserId(userId);
  }

  // Handles both the free first generation and a Premium-gated
  // regeneration through the same "has this user generated before" check
  // (ADR-002); a manually edited workout still counts as generated
  // (UT-017), since the only way a Workout row exists is generation.
  async regenerate(
    userId: string,
    daysPerWeek: number,
  ): Promise<WorkoutWithDetails> {
    if (!Number.isInteger(daysPerWeek) || daysPerWeek <= 0) {
      throw new AppError(MISSING_DAYS_PER_WEEK, 400);
    }

    const [user, profile, hasExisting] = await Promise.all([
      this.users.findByIdWithProduct(userId),
      this.fitnessProfiles.findByUserId(userId),
      this.workouts.existsForUser(userId),
    ]);
    if (!user) throw new AppError(NOT_FOUND, 404);
    if (!profile?.goal || !profile.equipment) {
      throw new AppError('Perfil de treino incompleto.', 400);
    }

    if (hasExisting && !this.premiumGuard.isPremium(user)) {
      throw new AppError(PREMIUM_REQUIRED, 402, 'premium_required');
    }

    return await this.generateAndPersist(userId, {
      goal: profile.goal,
      daysPerWeek,
      equipment: profile.equipment,
      restrictions: profile.restrictions,
      experienceLevel: profile.experienceLevel ?? undefined,
      muscleFocus: profile.muscleFocus ?? undefined,
    });
  }

  async updateExercise(
    userId: string,
    workoutExerciseId: string,
    input: UpdateWorkoutExerciseInput,
  ): Promise<WorkoutWithDetails> {
    const context = await this.workouts.findExerciseContext(workoutExerciseId);
    if (!context || context.workoutDay.workout.userId !== userId) {
      throw new AppError(NOT_FOUND, 404);
    }

    if (input.remove) {
      if (context.workoutDay._count.exercises <= 1) {
        throw new AppError(EMPTY_DAY, 400);
      }
      await this.workouts.deleteExerciseRow(workoutExerciseId);
      return await this.mustGetCurrent(userId);
    }

    if (input.sets !== undefined && input.sets <= 0) {
      throw new AppError(INVALID_SETS_REPS, 400);
    }
    if (input.reps !== undefined && input.reps <= 0) {
      throw new AppError(INVALID_SETS_REPS, 400);
    }

    if (input.exerciseId !== undefined) {
      await this.assertSafeReplacement(userId, input.exerciseId);
    }

    const data: UpdateWorkoutExerciseData = {};
    if (input.exerciseId !== undefined) data.exerciseId = input.exerciseId;
    if (input.sets !== undefined) data.sets = input.sets;
    if (input.reps !== undefined) data.reps = input.reps;
    await this.workouts.updateExerciseRow(workoutExerciseId, data);

    return await this.mustGetCurrent(userId);
  }

  private async answerAge(
    userId: string,
    conversationId: string,
    state: OrchestrationState,
    rawAnswer: string,
  ): Promise<ConversationTurnResult | WorkoutWithDetails> {
    const age = parseRangedInt(rawAnswer, MIN_AGE, MAX_AGE);
    if (age === null) {
      return this.repromptTurn(conversationId, 'age', AGE_QUESTION);
    }

    await this.users.updateUserProfile(userId, {
      birthDate: ageToBirthDate(age),
    });
    return await this.advance(userId, conversationId, {
      ...state,
      ageKnown: true,
      pendingField: null,
    });
  }

  private async answerWeight(
    userId: string,
    conversationId: string,
    state: OrchestrationState,
    rawAnswer: string,
  ): Promise<ConversationTurnResult | WorkoutWithDetails> {
    const weightKg = parseRangedFloat(rawAnswer, MIN_WEIGHT_KG, MAX_WEIGHT_KG);
    if (weightKg === null) {
      return this.repromptTurn(conversationId, 'weight', WEIGHT_QUESTION);
    }
    return await this.advance(userId, conversationId, {
      ...state,
      weightKg,
      pendingField: null,
    });
  }

  private async answerHeight(
    userId: string,
    conversationId: string,
    state: OrchestrationState,
    rawAnswer: string,
  ): Promise<ConversationTurnResult | WorkoutWithDetails> {
    const heightCm = parseRangedFloat(rawAnswer, MIN_HEIGHT_CM, MAX_HEIGHT_CM);
    if (heightCm === null) {
      return this.repromptTurn(conversationId, 'height', HEIGHT_QUESTION);
    }
    return await this.advance(userId, conversationId, {
      ...state,
      heightCm,
      pendingField: null,
    });
  }

  private async answerSessionDuration(
    userId: string,
    conversationId: string,
    state: OrchestrationState,
    rawAnswer: string,
  ): Promise<ConversationTurnResult | WorkoutWithDetails> {
    const sessionDurationMin = parseRangedInt(
      rawAnswer,
      MIN_SESSION_DURATION_MIN,
      MAX_SESSION_DURATION_MIN,
    );
    if (sessionDurationMin === null) {
      return this.repromptTurn(
        conversationId,
        'sessionDuration',
        SESSION_DURATION_QUESTION,
      );
    }
    return await this.advance(userId, conversationId, {
      ...state,
      sessionDurationMin,
      pendingField: null,
    });
  }

  // The last deterministic step (ADR-009/ADR-015): optional, so an empty
  // answer is a valid skip (persisted as `null`), never a reprompt.
  private async answerRestrictionDetail(
    userId: string,
    conversationId: string,
    state: OrchestrationState,
    rawAnswer: string,
  ): Promise<ConversationTurnResult | WorkoutWithDetails> {
    const trimmed = rawAnswer.trim();
    if (trimmed.length > MAX_RESTRICTION_DETAIL_LENGTH) {
      return this.repromptTurn(
        conversationId,
        'restrictionDetail',
        RESTRICTION_DETAIL_QUESTION,
        true,
      );
    }

    return await this.completeConversation(userId, conversationId, {
      ...state,
      restrictionDetail: trimmed.length === 0 ? null : trimmed,
      pendingField: null,
    });
  }

  // Asks the next question given the current state, with no raw answer to
  // parse yet — used right after `startConversation` and right after each
  // deterministic step resolves. Walks the deterministic steps in order
  // (age, weight, height, sessionDuration) before handing off to the LLM.
  private async advance(
    userId: string,
    conversationId: string,
    state: OrchestrationState,
  ): Promise<ConversationTurnResult | WorkoutWithDetails> {
    if (!state.ageKnown) {
      return this.askDeterministic(conversationId, state, 'age', AGE_QUESTION);
    }
    if (state.weightKg === undefined) {
      return this.askDeterministic(
        conversationId,
        state,
        'weight',
        WEIGHT_QUESTION,
      );
    }
    if (state.heightCm === undefined) {
      return this.askDeterministic(
        conversationId,
        state,
        'height',
        HEIGHT_QUESTION,
      );
    }
    if (state.sessionDurationMin === undefined) {
      return this.askDeterministic(
        conversationId,
        state,
        'sessionDuration',
        SESSION_DURATION_QUESTION,
      );
    }

    const turn = await this.llm.nextQuestion({ answers: state.answers });
    if (turn.done) {
      return await this.advanceAfterLlm(userId, conversationId, {
        ...state,
        answers: turn.answers,
      });
    }

    this.conversations.update(conversationId, {
      ...state,
      answers: turn.answers,
      pendingField: turn.field,
    });
    return {
      conversationId,
      field: turn.field,
      question: turn.question,
      done: false,
      reprompt: false,
      optional: false,
    };
  }

  // Runs once every LLM-schema field (sex, goal, daysPerWeek, equipment,
  // restrictions, experienceLevel, muscleFocus) is known — asks the final
  // deterministic step (restrictionDetail, UT-050) or, if it's already
  // known from a prior conversation, completes directly.
  private async advanceAfterLlm(
    userId: string,
    conversationId: string,
    state: OrchestrationState,
  ): Promise<ConversationTurnResult | WorkoutWithDetails> {
    if (state.restrictionDetail === undefined) {
      return this.askDeterministic(
        conversationId,
        state,
        'restrictionDetail',
        RESTRICTION_DETAIL_QUESTION,
      );
    }
    return await this.completeConversation(userId, conversationId, state);
  }

  private askDeterministic(
    conversationId: string,
    state: OrchestrationState,
    field: DeterministicField,
    question: string,
  ): ConversationTurnResult {
    this.conversations.update(conversationId, {
      ...state,
      pendingField: field,
    });
    return {
      conversationId,
      field,
      question,
      done: false,
      reprompt: false,
      optional: field === 'restrictionDetail',
    };
  }

  private repromptTurn(
    conversationId: string,
    field: DeterministicField,
    question: string,
    optional = false,
  ): ConversationTurnResult {
    return {
      conversationId,
      field,
      question,
      done: false,
      reprompt: true,
      optional,
    };
  }

  private async completeConversation(
    userId: string,
    conversationId: string,
    state: OrchestrationState,
  ): Promise<WorkoutWithDetails> {
    this.conversations.delete(conversationId);
    const { answers } = state;

    const user = await this.users.findUnique({ id: userId });
    // Never stores a restriction (or its free-text detail) without
    // consent, and never invents a second consent mechanism — reuses
    // `Users.healthDataConsentAt` as-is (UT-026).
    const consented = Boolean(user?.healthDataConsentAt);
    const restrictions = consented ? (answers.restrictions ?? []) : [];
    const restrictionDetail = consented
      ? (state.restrictionDetail ?? null)
      : null;

    await this.fitnessProfiles.upsert(userId, {
      sex: answers.sex,
      equipment: answers.equipment,
      goal: answers.goal,
      restrictions,
      restrictionDetail,
      weightKg: state.weightKg,
      heightCm: state.heightCm,
      experienceLevel: answers.experienceLevel,
      sessionDurationMin: state.sessionDurationMin,
      muscleFocus: toMuscleFocusPersistValue(answers.muscleFocus),
    });

    if (answers.daysPerWeek === undefined) {
      throw new AppError(MISSING_DAYS_PER_WEEK, 400);
    }

    return await this.regenerate(userId, answers.daysPerWeek);
  }

  private async generateAndPersist(
    userId: string,
    input: {
      goal: FitnessGoal;
      daysPerWeek: number;
      equipment: FitnessProfile['equipment'];
      restrictions: FitnessProfile['restrictions'];
      experienceLevel?: FitnessProfile['experienceLevel'];
      muscleFocus?: FitnessProfile['muscleFocus'];
    },
  ): Promise<WorkoutWithDetails> {
    if (!input.equipment) {
      throw new AppError('Perfil de treino incompleto.', 400);
    }

    const plan = await this.ruleEngine.select({
      goal: input.goal,
      daysPerWeek: input.daysPerWeek,
      equipment: input.equipment,
      restrictions: input.restrictions,
      experienceLevel: input.experienceLevel ?? undefined,
      muscleFocus: input.muscleFocus ?? undefined,
    });

    if (!isPlanUsable(plan)) {
      throw new AppError(NOT_ENOUGH_EXERCISES, 422);
    }

    const profile = await this.fitnessProfiles.findByUserId(userId);
    if (!profile) throw new AppError('Perfil de treino incompleto.', 400);

    const explanation = await this.llm.explain(plan, profile);
    return await this.workouts.replace(
      userId,
      toWorkoutInput(plan, input.goal, explanation),
    );
  }

  private async assertSafeReplacement(
    userId: string,
    exerciseId: string,
  ): Promise<void> {
    const [profile, exercise] = await Promise.all([
      this.fitnessProfiles.findByUserId(userId),
      this.exercises.findById(exerciseId),
    ]);
    if (!exercise || exercise.status !== ExerciseStatus.APPROVED) {
      throw new AppError(NOT_FOUND, 404);
    }
    const restrictions = profile?.restrictions ?? [];
    const contraindicated = exercise.contraindications.some((item) =>
      restrictions.includes(item),
    );
    if (contraindicated) {
      throw new AppError(CONTRAINDICATED, 400, 'contraindicated_exercise');
    }
  }

  private async mustGetCurrent(userId: string): Promise<WorkoutWithDetails> {
    const workout = await this.workouts.findCurrentByUserId(userId);
    if (!workout) throw new AppError(NOT_FOUND, 404);
    return workout;
  }
}

// Pre-fills everything a returning user's FitnessProfile already knows
// except `goal`, which ADR-003 always re-asks even when known (US-009
// AC-2). Editable by the user before the final answer either way (US-009
// AC-1 / UT-025), since these are just the conversation's starting values.
function prefillAnswers(profile: FitnessProfile | null): ConversationAnswers {
  if (!profile) return {};
  const answers: ConversationAnswers = {};
  if (profile.sex) answers.sex = profile.sex;
  if (profile.equipment) answers.equipment = profile.equipment;
  if (profile.restrictions.length > 0)
    answers.restrictions = profile.restrictions;
  if (profile.experienceLevel)
    answers.experienceLevel = profile.experienceLevel;
  if (profile.muscleFocus) answers.muscleFocus = profile.muscleFocus;
  return answers;
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

function parseRangedFloat(
  rawAnswer: string,
  min: number,
  max: number,
): number | null {
  const trimmed = rawAnswer.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (value < min || value > max) return null;
  return value;
}

function ageToBirthDate(age: number): Date {
  return new Date(Date.now() - age * 365.25 * DAY_IN_MS);
}

// 'NONE' (a resolved "no preference" answer) has no matching Prisma enum
// value, since FitnessProfile.muscleFocus can only be a real MuscleFocus or
// null — persisted as null, same as "not yet answered" (ADR-015's accepted
// trade-off, documented on MuscleFocusAnswer).
function toMuscleFocusPersistValue(
  answer: MuscleFocusAnswer | undefined,
): MuscleFocus | null | undefined {
  if (answer === 'NONE') return null;
  return answer;
}
