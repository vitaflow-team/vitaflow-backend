import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { Injectable, Logger } from '@nestjs/common';
import { ExerciseStatus, Prisma, ProductType } from '@prisma/client';
import { ExerciseCreateDto } from './dto/exerciseCreate.Dto';
import { ExerciseFilterDto } from './dto/exerciseFilter.Dto';
import { ExerciseSubmitDto } from './dto/exerciseSubmit.Dto';
import { ExerciseUpdateDto } from './dto/exerciseUpdate.Dto';
import { ExerciseEntity } from './exercise.entity';

export const EXERCISE_PAGE_SIZE = 50;

// An identical PENDING submission by the same educator inside this window is
// treated as a double-click/retry, not a new proposal.
export const DUPLICATE_SUBMISSION_WINDOW_MS = 10 * 60 * 1000;

const NOT_FOUND = 'Exercício não encontrado.';
const ALREADY_APPROVED = 'Exercício já está aprovado.';
const ALREADY_REJECTED = 'Exercício já foi rejeitado.';
const BLANK_NAME = 'O nome do exercício é obrigatório.';
const EDUCATORS_ONLY =
  'Apenas educadores físicos podem enviar exercícios ao catálogo.';
const DUPLICATE_SUBMISSION =
  'Você já enviou este exercício recentemente e ele está aguardando revisão.';

@Injectable()
export class ExerciseLibraryService {
  private readonly logger = new Logger(ExerciseLibraryService.name);

  constructor(
    private readonly exercises: ExercisesRepository,
    private readonly users: UserRepository,
  ) {}

  // Public callers never pass `status`: the default keeps the catalog
  // APPROVED-only. The backoffice pending queue is the only other caller.
  async findMany(
    filter: ExerciseFilterDto,
    status: ExerciseStatus = ExerciseStatus.APPROVED,
  ): Promise<ExerciseEntity[]> {
    const page = filter.page ?? 1;
    return await this.exercises.findMany({
      status,
      muscleGroup: filter.muscleGroup?.trim() || undefined,
      equipment: filter.equipment,
      q: filter.q?.trim() || undefined,
      skip: (page - 1) * EXERCISE_PAGE_SIZE,
      take: EXERCISE_PAGE_SIZE,
    });
  }

  // A non-APPROVED exercise answers the same 404 as a missing one, so a
  // regular caller cannot tell a pending submission exists.
  async findById(
    id: string,
    includeUnapproved = false,
  ): Promise<ExerciseEntity> {
    const exercise = await this.exercises.findById(id);
    if (!exercise) throw new AppError(NOT_FOUND, 404);
    if (!includeUnapproved && exercise.status !== ExerciseStatus.APPROVED) {
      throw new AppError(NOT_FOUND, 404);
    }
    return exercise;
  }

  async submit(
    dto: ExerciseSubmitDto,
    educatorId: string,
  ): Promise<ExerciseEntity> {
    await this.assertEducator(educatorId);
    assertNameNotBlank(dto.name);
    await this.assertNotDuplicateSubmission(dto, educatorId);

    return await this.exercises.create({
      ...toExerciseData(dto),
      status: ExerciseStatus.PENDING,
      submittedById: educatorId,
    });
  }

  async listOwnSubmissions(educatorId: string): Promise<ExerciseEntity[]> {
    await this.assertEducator(educatorId);
    return await this.exercises.findBySubmitter(educatorId);
  }

  async createDirect(
    dto: ExerciseCreateDto,
    backofficeId: string,
  ): Promise<ExerciseEntity> {
    assertNameNotBlank(dto.name);
    return await this.exercises.create({
      ...toExerciseData(dto),
      status: ExerciseStatus.APPROVED,
      reviewedById: backofficeId,
    });
  }

  async update(id: string, dto: ExerciseUpdateDto): Promise<ExerciseEntity> {
    if (dto.name !== undefined) assertNameNotBlank(dto.name);
    await this.findById(id, true);
    return await this.exercises.update(id, {
      ...dto,
      name: dto.name?.trim(),
    });
  }

  async remove(id: string): Promise<void> {
    await this.findById(id, true);
    await this.exercises.delete(id);
  }

  async approve(id: string, reviewerId: string): Promise<ExerciseEntity> {
    const decided = await this.exercises.decidePending(id, {
      status: ExerciseStatus.APPROVED,
      reviewedById: reviewerId,
    });
    if (!decided) await this.rejectInvalidTransition(id);

    this.logger.log(`exercise_approved exercise=${id} reviewer=${reviewerId}`);
    return await this.findById(id, true);
  }

  async reject(
    id: string,
    reviewerId: string,
    reason?: string,
  ): Promise<ExerciseEntity> {
    const decided = await this.exercises.decidePending(id, {
      status: ExerciseStatus.REJECTED,
      reviewedById: reviewerId,
      rejectionReason: reason?.trim() || null,
    });
    if (!decided) await this.rejectInvalidTransition(id);

    this.logger.log(`exercise_rejected exercise=${id} reviewer=${reviewerId}`);
    return await this.findById(id, true);
  }

  private async assertEducator(userId: string): Promise<void> {
    const user = await this.users.findByIdWithProduct(userId);
    if (user?.product?.type !== ProductType.PHYSICAL_EDUCATOR) {
      throw new AppError(EDUCATORS_ONLY, 403, 'not_physical_educator');
    }
  }

  private async assertNotDuplicateSubmission(
    dto: ExerciseSubmitDto,
    educatorId: string,
  ): Promise<void> {
    const duplicate = await this.exercises.findPendingDuplicate({
      submittedById: educatorId,
      name: dto.name.trim(),
      description: dto.description,
      muscleGroup: dto.muscleGroup,
      equipment: dto.equipment,
      createdSince: new Date(Date.now() - DUPLICATE_SUBMISSION_WINDOW_MS),
    });
    if (duplicate) {
      throw new AppError(DUPLICATE_SUBMISSION, 409, 'duplicate_submission');
    }
  }

  // Called only after a conditional PENDING-only update changed nothing:
  // explains why with the row's current state.
  private async rejectInvalidTransition(id: string): Promise<never> {
    const current = await this.exercises.findById(id);
    if (!current) throw new AppError(NOT_FOUND, 404);
    if (current.status === ExerciseStatus.APPROVED) {
      throw new AppError(ALREADY_APPROVED, 409, 'exercise_already_approved');
    }
    throw new AppError(ALREADY_REJECTED, 409, 'exercise_already_rejected');
  }
}

function assertNameNotBlank(name: string | undefined): void {
  if (!name?.trim()) throw new AppError(BLANK_NAME, 400);
}

function toExerciseData(
  dto: ExerciseSubmitDto,
): Prisma.ExerciseUncheckedCreateInput {
  return {
    name: dto.name.trim(),
    description: dto.description,
    muscleGroup: dto.muscleGroup,
    equipment: dto.equipment,
    contraindications: dto.contraindications ?? [],
    primaryMuscles: dto.primaryMuscles ?? [],
    secondaryMuscles: dto.secondaryMuscles ?? [],
    difficulty: dto.difficulty ?? null,
    imageUrl: dto.imageUrl ?? null,
    videoUrl: dto.videoUrl ?? null,
  };
}
