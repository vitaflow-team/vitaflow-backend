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
import { ExerciseStatus, FitnessGoal, FitnessProfile } from '@prisma/client';
import { ConversationStore, OrchestrationState } from './conversationStore';
import { isPlanUsable, toWorkoutInput } from './generatedPlan.util';
import { ConversationAnswers, ConversationField } from './llmExplanation.types';
import { LlmExplanationService } from './llmExplanation.service';
import { isPremiumUser } from './premiumAccess';
import { RuleEngineService } from './ruleEngine.service';
import { ConversationTurnResult } from './workouts.types';

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
const MIN_AGE = 10;
const MAX_AGE = 100;
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
  ) {}

  // No plan-tier check here (US-001 AC-1): every user, Free or Premium,
  // can always start.
  async startConversation(userId: string): Promise<ConversationTurnResult> {
    const [profile, user] = await Promise.all([
      this.fitnessProfiles.findByUserId(userId),
      this.users.findUnique({ id: userId }),
    ]);
    if (!user) throw new AppError(NOT_FOUND, 404);

    const state: OrchestrationState = {
      answers: prefillAnswers(profile),
      ageKnown: user.birthDate !== null,
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

    if (state.pendingField === 'age') {
      return await this.answerAge(userId, conversationId, state, rawAnswer);
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
      };
    }

    if (turn.done) {
      return await this.completeConversation(
        userId,
        conversationId,
        turn.answers,
      );
    }

    this.conversations.update(conversationId, {
      answers: turn.answers,
      ageKnown: true,
      pendingField: turn.field,
    });
    return {
      conversationId,
      field: turn.field,
      question: turn.question,
      done: false,
      reprompt: false,
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

    if (hasExisting) {
      const premium = isPremiumUser({
        subscriptionStatus: user.subscriptionStatus,
        productPrice: user.product?.price ?? null,
      });
      if (!premium) {
        throw new AppError(PREMIUM_REQUIRED, 402, 'premium_required');
      }
    }

    return await this.generateAndPersist(userId, {
      goal: profile.goal,
      daysPerWeek,
      equipment: profile.equipment,
      restrictions: profile.restrictions,
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
  ): Promise<ConversationTurnResult> {
    const age = parseAge(rawAnswer);
    if (age === null) {
      return {
        conversationId,
        field: 'age',
        question: AGE_QUESTION,
        done: false,
        reprompt: true,
      };
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

  // Asks the next question given the current state, with no raw answer to
  // parse yet — used right after `startConversation` and right after the
  // age step resolves.
  private async advance(
    userId: string,
    conversationId: string,
    state: OrchestrationState,
  ): Promise<ConversationTurnResult> {
    if (!state.ageKnown) {
      this.conversations.update(conversationId, {
        ...state,
        pendingField: 'age',
      });
      return {
        conversationId,
        field: 'age',
        question: AGE_QUESTION,
        done: false,
        reprompt: false,
      };
    }

    const turn = await this.llm.nextQuestion({ answers: state.answers });
    this.conversations.update(conversationId, {
      answers: turn.answers,
      ageKnown: true,
      pendingField: turn.done ? null : turn.field,
    });
    return {
      conversationId,
      field: turn.field,
      question: turn.question,
      done: turn.done,
      reprompt: false,
    };
  }

  private async completeConversation(
    userId: string,
    conversationId: string,
    answers: ConversationAnswers,
  ): Promise<WorkoutWithDetails> {
    this.conversations.delete(conversationId);

    const user = await this.users.findUnique({ id: userId });
    // Never stores a restriction without consent, and never invents a
    // second consent mechanism — reuses `Users.healthDataConsentAt` as-is
    // (UT-026).
    const consented = Boolean(user?.healthDataConsentAt);
    const restrictions = consented ? (answers.restrictions ?? []) : [];

    await this.fitnessProfiles.upsert(userId, {
      sex: answers.sex,
      equipment: answers.equipment,
      goal: answers.goal,
      restrictions,
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
  return answers;
}

function parseAge(rawAnswer: string): number | null {
  const trimmed = rawAnswer.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const age = Number(trimmed);
  if (age < MIN_AGE || age > MAX_AGE) return null;
  return age;
}

function ageToBirthDate(age: number): Date {
  return new Date(Date.now() - age * 365.25 * DAY_IN_MS);
}
