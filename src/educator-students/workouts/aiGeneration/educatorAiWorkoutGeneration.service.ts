import { Injectable, Logger } from '@nestjs/common';
import { Client, ExerciseContraindication, MuscleFocus } from '@prisma/client';
import { CodedError } from '@/common/errors/codedError';
import { ConversationStore } from '@/common/conversation/conversationStore';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { isPlanUsable } from '@/workouts/generatedPlan.util';
import { RuleEngineService } from '@/workouts/ruleEngine.service';
import { findOwnedStudent } from '../../students/studentOwnership.util';
import {
  WORKOUT_FREQUENCY_MAX,
  WORKOUT_FREQUENCY_MIN,
} from '../workoutLimits.constants';
import { toTreeResponse } from '../workoutResponse.util';
import { WorkoutTreeResponseDTO } from '../dto/workoutResponse.Dto';
import {
  EducatorAiWorkoutAnswers,
  EducatorAiWorkoutConversationState,
  EducatorAiWorkoutConversationTurn,
} from './educatorAiWorkoutConversation.types';
import { EducatorAiWorkoutLlmService } from './educatorAiWorkoutLlm.service';
import { toEducatorWorkoutInput } from './educatorAiWorkoutGeneration.util';

const CONVERSATION_NOT_FOUND = 'Conversa não encontrada ou expirada.';
const WORKOUT_NOT_FOUND = 'Treino não encontrado.';
const CONFIRM_OVERWRITE_REQUIRED =
  'Este rascunho foi editado manualmente desde a última geração. Confirme para sobrescrever.';
const NO_ELIGIBLE_EXERCISES =
  'Não foi possível gerar um treino com as restrições e o equipamento informados.';
const INCOMPLETE_ANSWERS = 'Respostas incompletas para gerar o treino.';
const DEFAULT_GENERATED_TITLE = 'Treino gerado por IA';

function invalidDaysPerWeek(value: number | undefined): boolean {
  if (value === undefined) return false;
  return (
    !Number.isInteger(value) ||
    value < WORKOUT_FREQUENCY_MIN ||
    value > WORKOUT_FREQUENCY_MAX
  );
}

function toRuleEngineMuscleFocus(
  answer: EducatorAiWorkoutAnswers['muscleFocus'],
): MuscleFocus | undefined {
  if (!answer || answer === 'NONE') return undefined;
  return answer;
}

/**
 * Orchestrates the AI workout generation conversation end to end:
 * conversational intake (ai-workout-prescription-b2b ADR-003), deterministic
 * rule-engine selection (ADR-001), an educator-only explanation, and the
 * write into an ordinary EducatorWorkout draft (ADR-004) — either a brand
 * new one or an explicit, caller-provided target being regenerated (ADR-011).
 */
@Injectable()
export class EducatorAiWorkoutGenerationService {
  private readonly logger = new Logger(EducatorAiWorkoutGenerationService.name);

  constructor(
    private readonly clients: ClientsRepository,
    private readonly workouts: EducatorWorkoutsRepository,
    private readonly exercises: ExercisesRepository,
    private readonly profiles: FitnessProfileRepository,
    private readonly ruleEngine: RuleEngineService,
    private readonly llm: EducatorAiWorkoutLlmService,
    private readonly conversations: ConversationStore<EducatorAiWorkoutConversationState>,
  ) {}

  async startConversation(
    educatorId: string,
    studentId: string,
    workoutId?: string,
    confirmOverwrite?: boolean,
  ): Promise<EducatorAiWorkoutConversationTurn | WorkoutTreeResponseDTO> {
    const student = await findOwnedStudent(this.clients, educatorId, studentId);

    let existingTitle: string | null = null;
    if (workoutId) {
      existingTitle = await this.assertRegenerateAllowed(
        student.id,
        workoutId,
        confirmOverwrite ?? false,
      );
    }

    const state: EducatorAiWorkoutConversationState = {
      studentId: student.id,
      targetWorkoutId: workoutId ?? null,
      existingTitle,
      answers: {},
    };
    const conversationId = this.conversations.create(educatorId, state);

    return await this.askNext(educatorId, conversationId, state);
  }

  async answer(
    educatorId: string,
    conversationId: string,
    rawAnswer: string,
  ): Promise<EducatorAiWorkoutConversationTurn | WorkoutTreeResponseDTO> {
    const state = this.conversations.get(educatorId, conversationId);
    if (!state) {
      throw new CodedError(
        CONVERSATION_NOT_FOUND,
        404,
        'conversation_not_found',
      );
    }

    return await this.askNext(educatorId, conversationId, {
      ...state,
      pendingRawAnswer: rawAnswer,
    });
  }

  // Throws 404 if the target draft doesn't belong to this student, or 409
  // confirm_overwrite_required if it was manually edited since its last
  // generation and the caller hasn't confirmed yet. Returns the draft's
  // current title, preserved across a regenerate (ADR-009).
  private async assertRegenerateAllowed(
    clientId: string,
    workoutId: string,
    confirmOverwrite: boolean,
  ): Promise<string> {
    const target = await this.workouts.findOwnedTree(workoutId, clientId);
    if (!target) {
      throw new CodedError(WORKOUT_NOT_FOUND, 404, 'workout_not_found');
    }

    const editedSinceGeneration =
      target.lastGeneratedAt !== null &&
      target.updatedAt > target.lastGeneratedAt;
    if (editedSinceGeneration && !confirmOverwrite) {
      throw new CodedError(
        CONFIRM_OVERWRITE_REQUIRED,
        409,
        'confirm_overwrite_required',
      );
    }
    return target.title;
  }

  private async askNext(
    educatorId: string,
    conversationId: string,
    state: EducatorAiWorkoutConversationState,
  ): Promise<EducatorAiWorkoutConversationTurn | WorkoutTreeResponseDTO> {
    const turn = await this.llm.nextQuestion(state);

    if (invalidDaysPerWeek(turn.answers.daysPerWeek)) {
      return this.repromptDaysPerWeek(conversationId, state, turn.answers);
    }

    if (turn.done) {
      return await this.completeConversation(educatorId, conversationId, {
        ...state,
        answers: turn.answers,
      });
    }

    this.conversations.update(conversationId, {
      ...state,
      answers: turn.answers,
      pendingField: turn.field ?? undefined,
      pendingRawAnswer: undefined,
    });
    return turn;
  }

  private repromptDaysPerWeek(
    conversationId: string,
    state: EducatorAiWorkoutConversationState,
    answers: EducatorAiWorkoutAnswers,
  ): EducatorAiWorkoutConversationTurn {
    const corrected = { ...answers, daysPerWeek: undefined };
    this.conversations.update(conversationId, {
      ...state,
      answers: corrected,
      pendingField: 'daysPerWeek',
      pendingRawAnswer: undefined,
    });
    return {
      answers: corrected,
      field: 'daysPerWeek',
      question: `Quantos dias por semana? Informe um número entre ${WORKOUT_FREQUENCY_MIN} e ${WORKOUT_FREQUENCY_MAX}.`,
      done: false,
      reprompt: true,
    };
  }

  private async completeConversation(
    educatorId: string,
    conversationId: string,
    state: EducatorAiWorkoutConversationState,
  ): Promise<WorkoutTreeResponseDTO> {
    this.conversations.delete(conversationId);
    const { answers } = state;

    if (!answers.goal || !answers.daysPerWeek || !answers.equipment) {
      throw new CodedError(INCOMPLETE_ANSWERS, 400, 'incomplete_answers');
    }

    const student = await findOwnedStudent(
      this.clients,
      educatorId,
      state.studentId,
    );
    const result = await this.generateAndPersist(student, state, {
      goal: answers.goal,
      daysPerWeek: answers.daysPerWeek,
      equipment: answers.equipment,
      experienceLevel: answers.experienceLevel,
      muscleFocus: answers.muscleFocus,
    });

    return toTreeResponse(result, new Map());
  }

  private async generateAndPersist(
    student: Client,
    state: EducatorAiWorkoutConversationState,
    answers: Required<
      Pick<EducatorAiWorkoutAnswers, 'goal' | 'daysPerWeek' | 'equipment'>
    > &
      Pick<EducatorAiWorkoutAnswers, 'experienceLevel' | 'muscleFocus'>,
  ) {
    const restrictions = await this.restrictionsOf(student);
    const plan = await this.ruleEngine.select({
      goal: answers.goal,
      daysPerWeek: answers.daysPerWeek,
      equipment: answers.equipment,
      restrictions,
      experienceLevel: answers.experienceLevel,
      muscleFocus: toRuleEngineMuscleFocus(answers.muscleFocus),
    });

    if (!isPlanUsable(plan)) {
      throw new CodedError(NO_ELIGIBLE_EXERCISES, 422, 'no_eligible_exercises');
    }

    const exercisesById = await this.loadExercisesById(plan);
    const explanation = await this.llm.explain(
      answers.daysPerWeek,
      plan.days.map((day) => day.exercises.length),
      plan.scaled,
      answers,
    );
    const title = state.existingTitle ?? DEFAULT_GENERATED_TITLE;
    const tree = toEducatorWorkoutInput(
      title,
      answers.daysPerWeek,
      plan,
      exercisesById,
    );
    const now = new Date();

    return state.targetWorkoutId
      ? await this.workouts.applyGeneratedTree(
          state.targetWorkoutId,
          tree,
          explanation,
          now,
        )
      : await this.workouts.createGeneratedDraft(
          student.id,
          tree,
          explanation,
          now,
        );
  }

  private async loadExercisesById(plan: {
    days: { exercises: { exerciseId: string }[] }[];
  }) {
    const ids = [
      ...new Set(
        plan.days.flatMap((day) => day.exercises.map((e) => e.exerciseId)),
      ),
    ];
    const rows = await this.exercises.findApprovedByIds(ids);
    return new Map(rows.map((row) => [row.id, row]));
  }

  // Mirrors EducatorWorkoutsService.restrictionsOf exactly (replicated, not
  // imported, since that method is private to a file this task must not
  // modify) — a student with no linked account or no profile has no
  // restrictions, never a blocked generation.
  private async restrictionsOf(
    student: Client,
  ): Promise<ExerciseContraindication[]> {
    if (!student.userId) return [];
    try {
      const profile = await this.profiles.findByUserId(student.userId);
      return profile?.restrictions ?? [];
    } catch {
      this.logger.warn(
        `educator_ai_workout_restrictions_unreadable clientId=${student.id}`,
      );
      return [];
    }
  }
}
