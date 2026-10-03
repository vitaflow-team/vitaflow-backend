import { PrismaService } from '@/database/prisma.service';
import { escapeLikePattern } from '@/utils/escapeLikePattern';
import { Injectable } from '@nestjs/common';
import { Exercise, ExerciseStatus, Prisma } from '@prisma/client';
import { ExerciseSearchCriteria } from './exerciseSearchCriteria';
import { PendingDuplicateCriteria } from './pendingDuplicateCriteria';
import { ReviewDecision } from './reviewDecision';

@Injectable()
export class ExercisesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.ExerciseUncheckedCreateInput): Promise<Exercise> {
    return await this.prisma.exercise.create({ data });
  }

  async findMany(criteria: ExerciseSearchCriteria): Promise<Exercise[]> {
    return await this.prisma.exercise.findMany({
      where: toSearchWhere(criteria),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: criteria.skip,
      take: criteria.take,
    });
  }

  async findById(id: string): Promise<Exercise | null> {
    return await this.prisma.exercise.findUnique({ where: { id } });
  }

  // Only approved exercises: a pending, rejected or unknown id is simply absent.
  async findApprovedByIds(ids: string[]): Promise<Exercise[]> {
    return await this.prisma.exercise.findMany({
      where: { id: { in: ids }, status: ExerciseStatus.APPROVED },
    });
  }

  async findBySubmitter(submittedById: string): Promise<Exercise[]> {
    return await this.prisma.exercise.findMany({
      where: { submittedById },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Lets the one-time catalog import skip rows it already created.
  async findBySource(
    name: string,
    sourceAttribution: string,
  ): Promise<Exercise | null> {
    return await this.prisma.exercise.findFirst({
      where: { name, sourceAttribution },
    });
  }

  async findPendingDuplicate(
    criteria: PendingDuplicateCriteria,
  ): Promise<Exercise | null> {
    const { createdSince, ...fields } = criteria;
    return await this.prisma.exercise.findFirst({
      where: {
        ...fields,
        status: ExerciseStatus.PENDING,
        createdAt: { gte: createdSince },
      },
    });
  }

  async update(
    id: string,
    data: Prisma.ExerciseUncheckedUpdateInput,
  ): Promise<Exercise> {
    return await this.prisma.exercise.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.exercise.delete({ where: { id } });
  }

  // Conditional update: only a row still PENDING changes, in a single
  // statement, so two concurrent reviewers can never both decide the same
  // submission. Returns whether this call was the one that decided it.
  async decidePending(id: string, decision: ReviewDecision): Promise<boolean> {
    const { count } = await this.prisma.exercise.updateMany({
      where: { id, status: ExerciseStatus.PENDING },
      data: decision,
    });
    return count === 1;
  }
}

function toSearchWhere(
  criteria: ExerciseSearchCriteria,
): Prisma.ExerciseWhereInput {
  const { status, muscleGroup, equipment, q } = criteria;
  const where: Prisma.ExerciseWhereInput = { status };

  if (equipment) where.equipment = equipment;
  if (q) where.name = { contains: escapeLikePattern(q), mode: 'insensitive' };
  if (muscleGroup) {
    // An exercise tagged with several muscles matches every one of them,
    // not only its headline muscle group.
    where.OR = [
      {
        muscleGroup: {
          equals: escapeLikePattern(muscleGroup),
          mode: 'insensitive',
        },
      },
      { primaryMuscles: { has: muscleGroup } },
    ];
  }

  return where;
}
