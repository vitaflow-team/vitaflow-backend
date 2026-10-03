import { CodedError } from '@/common/errors/codedError';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import {
  EducatorWorkoutsRepository,
  WorkoutSummaryRow,
  WorkoutTree,
} from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { Injectable, Logger } from '@nestjs/common';
import {
  Client,
  EducatorExerciseSource,
  EducatorWorkoutStatus,
  ExerciseContraindication,
} from '@prisma/client';
import { findOwnedStudent } from '../students/studentOwnership.util';
import { ConflictsRequestDTO } from './dto/conflictsRequest.Dto';
import { CreateWorkoutDTO } from './dto/createWorkout.Dto';
import { DuplicateWorkoutDTO } from './dto/duplicateWorkout.Dto';
import { SaveWorkoutDTO } from './dto/saveWorkout.Dto';
import {
  ConflictsResponseDTO,
  DuplicateResponseDTO,
  WorkoutListResponseDTO,
  WorkoutSummaryDTO,
  WorkoutTreeResponseDTO,
} from './dto/workoutResponse.Dto';
import { toTreeResponse } from './workoutResponse.util';
import {
  ARCHIVED_PAGE_SIZE,
  DUPLICATE_TARGETS_MAX,
} from './workoutLimits.constants';
import { WorkoutNotificationsService } from './workoutNotifications.service';
import { resolveTree } from './workoutResolve.util';
import {
  computeConflicts,
  toCopyTree,
  validateActivatable,
} from './workoutTree.util';

const WORKOUT_NOT_FOUND = 'Treino não encontrado.';

function toSummary(row: WorkoutSummaryRow): WorkoutSummaryDTO {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

@Injectable()
export class EducatorWorkoutsService {
  private readonly logger = new Logger(EducatorWorkoutsService.name);

  constructor(
    private readonly clients: ClientsRepository,
    private readonly workouts: EducatorWorkoutsRepository,
    private readonly exercises: ExercisesRepository,
    private readonly profiles: FitnessProfileRepository,
    private readonly notifications: WorkoutNotificationsService,
  ) {}

  async list(
    educatorId: string,
    studentId: string,
    archivedPage = 1,
  ): Promise<WorkoutListResponseDTO> {
    const student = await findOwnedStudent(this.clients, educatorId, studentId);
    const result = await this.workouts.listSummariesByClient(
      student.id,
      (archivedPage - 1) * ARCHIVED_PAGE_SIZE,
      ARCHIVED_PAGE_SIZE,
    );

    return {
      active: result.active ? toSummary(result.active) : null,
      drafts: result.drafts.map(toSummary),
      archived: {
        items: result.archived.items.map(toSummary),
        total: result.archived.total,
        page: archivedPage,
        pageSize: ARCHIVED_PAGE_SIZE,
      },
    };
  }

  async create(
    educatorId: string,
    studentId: string,
    dto: CreateWorkoutDTO,
  ): Promise<WorkoutTreeResponseDTO> {
    const student = await findOwnedStudent(this.clients, educatorId, studentId);
    const created = await this.workouts.createDraft(student.id, {
      title: dto.title,
      weeklyFrequency: dto.weeklyFrequency,
    });
    this.logger.log(
      `workout_created educatorId=${educatorId} workoutId=${created.id}`,
    );
    return toTreeResponse(created, new Map());
  }

  async get(
    educatorId: string,
    studentId: string,
    workoutId: string,
  ): Promise<WorkoutTreeResponseDTO> {
    const student = await findOwnedStudent(this.clients, educatorId, studentId);
    const tree = await this.findTree(workoutId, student.id);
    return await this.respond(student, tree);
  }

  async save(
    educatorId: string,
    studentId: string,
    workoutId: string,
    dto: SaveWorkoutDTO,
  ): Promise<WorkoutTreeResponseDTO> {
    const student = await findOwnedStudent(this.clients, educatorId, studentId);
    const current = await this.findTree(workoutId, student.id);

    const resolved = await resolveTree(dto, current, this.exercises);
    if (current.status === EducatorWorkoutStatus.ACTIVE) {
      const problems = validateActivatable(resolved);
      if (problems.length > 0) {
        throw new CodedError(
          'Um treino ativo precisa ter ao menos uma sessão e um exercício em cada sessão.',
          422,
          'workout_active_invalid',
          problems,
        );
      }
    }

    const saved = await this.workouts.applyTree(current.id, resolved);
    this.logger.log(
      `workout_saved workoutId=${saved.id} status=${saved.status} sessionCount=${saved.sessions.length} exerciseCount=${countExercises(saved)}`,
    );

    if (saved.status === EducatorWorkoutStatus.ACTIVE) {
      await this.notifications.notifyEdited(educatorId, student.id, saved.id);
    }
    return await this.respond(student, saved);
  }

  async activate(
    educatorId: string,
    studentId: string,
    workoutId: string,
  ): Promise<WorkoutTreeResponseDTO> {
    const student = await findOwnedStudent(this.clients, educatorId, studentId);
    const tree = await this.findTree(workoutId, student.id);
    if (tree.status === EducatorWorkoutStatus.ACTIVE) {
      return await this.respond(student, tree);
    }

    const problems = validateActivatable(tree);
    if (problems.length > 0) {
      throw new CodedError(
        'Todas as sessões precisam ter ao menos um exercício para ativar o treino.',
        422,
        'workout_not_activatable',
        problems,
      );
    }

    const changed = await this.workouts.activate(student.id, tree.id);
    if (changed) {
      this.logger.log(`workout_activated workoutId=${tree.id}`);
      await this.notifications.notifyActivated(educatorId, student.id, tree.id);
    }
    return await this.respond(
      student,
      await this.findTree(tree.id, student.id),
    );
  }

  async deactivate(
    educatorId: string,
    studentId: string,
    workoutId: string,
  ): Promise<WorkoutTreeResponseDTO> {
    const student = await findOwnedStudent(this.clients, educatorId, studentId);
    const tree = await this.findTree(workoutId, student.id);
    if (tree.status !== EducatorWorkoutStatus.ACTIVE) {
      return await this.respond(student, tree);
    }

    await this.workouts.deactivate(tree.id);
    this.logger.log(`workout_deactivated workoutId=${tree.id}`);
    return await this.respond(
      student,
      await this.findTree(tree.id, student.id),
    );
  }

  async remove(
    educatorId: string,
    studentId: string,
    workoutId: string,
  ): Promise<void> {
    const student = await findOwnedStudent(this.clients, educatorId, studentId);
    const tree = await this.findTree(workoutId, student.id);
    if (tree.status === EducatorWorkoutStatus.ACTIVE) {
      throw new CodedError(
        'Desative o treino antes de excluí-lo.',
        409,
        'workout_is_active',
      );
    }

    await this.workouts.delete(tree.id);
    this.logger.log(`workout_deleted workoutId=${tree.id}`);
  }

  async duplicate(
    educatorId: string,
    studentId: string,
    workoutId: string,
    dto: DuplicateWorkoutDTO,
  ): Promise<DuplicateResponseDTO> {
    const student = await findOwnedStudent(this.clients, educatorId, studentId);
    const source = await this.findTree(workoutId, student.id);

    const targetIds = [...new Set(dto.studentIds)];
    if (targetIds.length > DUPLICATE_TARGETS_MAX) {
      throw new CodedError(
        `Escolha no máximo ${DUPLICATE_TARGETS_MAX} alunos por vez.`,
        400,
        'duplicate_limit',
      );
    }
    const owned = await this.clients.findOwnedByIds(targetIds, educatorId);
    if (owned.length !== targetIds.length) {
      throw new CodedError(
        'Algum dos alunos escolhidos não foi encontrado.',
        404,
        'duplicate_targets_invalid',
      );
    }

    const copies = await this.workouts.copyToClients(
      targetIds.map((clientId) => ({
        clientId,
        tree: toCopyTree(source, clientId === student.id),
      })),
    );
    this.logger.log(
      `workout_duplicated sourceId=${source.id} targetCount=${copies.length}`,
    );
    return {
      copies: copies.map((copy) => ({
        studentId: copy.clientId,
        workoutId: copy.workoutId,
      })),
    };
  }

  async conflicts(
    educatorId: string,
    studentId: string,
    dto: ConflictsRequestDTO,
  ): Promise<ConflictsResponseDTO> {
    const student = await findOwnedStudent(this.clients, educatorId, studentId);
    const restrictions = await this.restrictionsOf(student);
    if (restrictions.length === 0) return { conflicts: {} };

    const library = await this.exercises.findApprovedByIds(dto.exerciseIds);
    const found = computeConflicts(
      library.map((exercise) => ({
        id: exercise.id,
        contraindications: exercise.contraindications,
      })),
      restrictions,
    );
    return { conflicts: Object.fromEntries(found) };
  }

  private async findTree(
    workoutId: string,
    clientId: string,
  ): Promise<WorkoutTree> {
    const tree = await this.workouts.findOwnedTree(workoutId, clientId);
    if (!tree) {
      throw new CodedError(WORKOUT_NOT_FOUND, 404, 'workout_not_found');
    }
    return tree;
  }

  private async respond(
    student: Client,
    tree: WorkoutTree,
  ): Promise<WorkoutTreeResponseDTO> {
    const restrictions = await this.restrictionsOf(student);
    const conflicts = computeConflicts(
      tree.sessions.flatMap((session) =>
        session.exercises.map((exercise) => ({
          id: exercise.id,
          contraindications:
            exercise.source === EducatorExerciseSource.LIBRARY
              ? exercise.exercise?.contraindications
              : null,
        })),
      ),
      restrictions,
    );
    return toTreeResponse(tree, conflicts);
  }

  // The student's own registered restrictions, or none: no account, no
  // profile, or a profile that cannot be read never blocks the educator.
  private async restrictionsOf(
    student: Client,
  ): Promise<ExerciseContraindication[]> {
    if (!student.userId) return [];
    try {
      const profile = await this.profiles.findByUserId(student.userId);
      return profile?.restrictions ?? [];
    } catch {
      this.logger.warn(
        `workout_conflicts_profile_unreadable clientId=${student.id}`,
      );
      return [];
    }
  }
}

function countExercises(tree: WorkoutTree): number {
  return tree.sessions.reduce(
    (total, session) => total + session.exercises.length,
    0,
  );
}
