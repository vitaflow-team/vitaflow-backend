import { PrismaService } from '@/database/prisma.service';
import {
  CopyTreeInput,
  WorkoutTreeInput,
} from '@/educator-students/workouts/workoutTree.util';
import { Injectable } from '@nestjs/common';
import { EducatorWorkoutStatus, Prisma } from '@prisma/client';

const TREE_INCLUDE = {
  sessions: {
    orderBy: { position: 'asc' },
    include: {
      exercises: {
        orderBy: { position: 'asc' },
        include: {
          // What a student read and the conflict check need from the library.
          exercise: { select: { videoUrl: true, contraindications: true } },
        },
      },
    },
  },
} satisfies Prisma.EducatorWorkoutInclude;

export type WorkoutTree = Prisma.EducatorWorkoutGetPayload<{
  include: typeof TREE_INCLUDE;
}>;

export interface WorkoutSummaryRow {
  id: string;
  title: string;
  status: EducatorWorkoutStatus;
  weeklyFrequency: number | null;
  sessionCount: number;
  exerciseCount: number;
  updatedAt: Date;
}

export interface WorkoutListResult {
  active: WorkoutSummaryRow | null;
  drafts: WorkoutSummaryRow[];
  archived: { items: WorkoutSummaryRow[]; total: number };
}

const SUMMARY_SELECT = {
  id: true,
  title: true,
  status: true,
  weeklyFrequency: true,
  updatedAt: true,
  sessions: { select: { _count: { select: { exercises: true } } } },
} satisfies Prisma.EducatorWorkoutSelect;

type SummarySource = Prisma.EducatorWorkoutGetPayload<{
  select: typeof SUMMARY_SELECT;
}>;

function toSummary(row: SummarySource): WorkoutSummaryRow {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    weeklyFrequency: row.weeklyFrequency,
    updatedAt: row.updatedAt,
    sessionCount: row.sessions.length,
    exerciseCount: row.sessions.reduce(
      (total, session) => total + session._count.exercises,
      0,
    ),
  };
}

function toCreateData(tree: WorkoutTreeInput) {
  return {
    title: tree.title,
    weeklyFrequency: tree.weeklyFrequency,
    sessions: {
      create: tree.sessions.map((session, sessionPosition) => ({
        name: session.name,
        position: sessionPosition,
        exercises: {
          create: session.exercises.map((exercise, position) => ({
            position,
            source: exercise.source,
            exerciseId: exercise.exerciseId,
            name: exercise.name,
            muscleGroup: exercise.muscleGroup,
            equipment: exercise.equipment,
            sets: exercise.sets,
            reps: exercise.reps,
            load: exercise.load,
            videoUrl: exercise.videoUrl,
          })),
        },
      })),
    },
  };
}

@Injectable()
export class EducatorWorkoutsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // The tree only when the workout belongs to this student record: another
  // record's workout resolves to null, like an id that does not exist.
  async findOwnedTree(
    workoutId: string,
    clientId: string,
  ): Promise<WorkoutTree | null> {
    return await this.prisma.educatorWorkout.findFirst({
      where: { id: workoutId, clientId },
      include: TREE_INCLUDE,
    });
  }

  async listSummariesByClient(
    clientId: string,
    archivedSkip: number,
    archivedTake: number,
  ): Promise<WorkoutListResult> {
    const [active, drafts, archived, archivedTotal] = await Promise.all([
      this.prisma.educatorWorkout.findFirst({
        where: { clientId, status: EducatorWorkoutStatus.ACTIVE },
        select: SUMMARY_SELECT,
      }),
      this.prisma.educatorWorkout.findMany({
        where: { clientId, status: EducatorWorkoutStatus.DRAFT },
        select: SUMMARY_SELECT,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.educatorWorkout.findMany({
        where: { clientId, status: EducatorWorkoutStatus.ARCHIVED },
        select: SUMMARY_SELECT,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: archivedSkip,
        take: archivedTake,
      }),
      this.prisma.educatorWorkout.count({
        where: { clientId, status: EducatorWorkoutStatus.ARCHIVED },
      }),
    ]);

    return {
      active: active ? toSummary(active) : null,
      drafts: drafts.map(toSummary),
      archived: { items: archived.map(toSummary), total: archivedTotal },
    };
  }

  async createDraft(
    clientId: string,
    data: { title: string; weeklyFrequency?: number | null },
  ): Promise<WorkoutTree> {
    return await this.prisma.educatorWorkout.create({
      data: {
        clientId,
        title: data.title,
        weeklyFrequency: data.weeklyFrequency ?? null,
      },
      include: TREE_INCLUDE,
    });
  }

  /**
   * Applies a whole tree in one transaction (ADR-008). Items that carry an id
   * of this workout keep it (and may move to another session); items without
   * one are created; items missing from the request are deleted; positions are
   * rewritten from the request order.
   */
  async applyTree(
    workoutId: string,
    tree: WorkoutTreeInput,
  ): Promise<WorkoutTree> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.educatorWorkout.update({
        where: { id: workoutId },
        data: { title: tree.title, weeklyFrequency: tree.weeklyFrequency },
      });

      const keptSessionIds: string[] = [];
      const keptExerciseIds: string[] = [];

      for (const [sessionPosition, session] of tree.sessions.entries()) {
        const sessionId = await this.upsertSession(tx, {
          workoutId,
          id: session.id,
          name: session.name,
          position: sessionPosition,
        });
        keptSessionIds.push(sessionId);

        for (const [position, exercise] of session.exercises.entries()) {
          const data = {
            sessionId,
            position,
            source: exercise.source,
            exerciseId: exercise.exerciseId,
            name: exercise.name,
            muscleGroup: exercise.muscleGroup,
            equipment: exercise.equipment,
            sets: exercise.sets,
            reps: exercise.reps,
            load: exercise.load,
            videoUrl: exercise.videoUrl,
          };
          if (exercise.id) {
            await tx.educatorWorkoutExercise.update({
              where: { id: exercise.id, session: { workoutId } },
              data,
            });
            keptExerciseIds.push(exercise.id);
          } else {
            const created = await tx.educatorWorkoutExercise.create({ data });
            keptExerciseIds.push(created.id);
          }
        }
      }

      // Exercises first: one that moved sessions is already updated above, so
      // deleting a session never takes a kept exercise with it.
      await tx.educatorWorkoutExercise.deleteMany({
        where: {
          session: { workoutId },
          id: { notIn: keptExerciseIds },
        },
      });
      await tx.educatorWorkoutSession.deleteMany({
        where: { workoutId, id: { notIn: keptSessionIds } },
      });

      return await tx.educatorWorkout.findUniqueOrThrow({
        where: { id: workoutId },
        include: TREE_INCLUDE,
      });
    });
  }

  private async upsertSession(
    tx: Prisma.TransactionClient,
    input: { workoutId: string; id?: string; name: string; position: number },
  ): Promise<string> {
    if (input.id) {
      await tx.educatorWorkoutSession.update({
        where: { id: input.id, workoutId: input.workoutId },
        data: { name: input.name, position: input.position },
      });
      return input.id;
    }
    const created = await tx.educatorWorkoutSession.create({
      data: {
        workoutId: input.workoutId,
        name: input.name,
        position: input.position,
      },
    });
    return created.id;
  }

  /**
   * Makes `workoutId` the only active workout of the record. The student
   * record row is locked first, so two simultaneous activations run one after
   * the other; the partial unique index is the final safeguard. Returns false
   * (and writes nothing) when the workout was already active.
   */
  async activate(clientId: string, workoutId: string): Promise<boolean> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${clientId} FOR UPDATE`;

      const target = await tx.educatorWorkout.findFirst({
        where: { id: workoutId, clientId },
        select: { status: true },
      });
      if (!target) return false;
      if (target.status === EducatorWorkoutStatus.ACTIVE) return false;

      await tx.educatorWorkout.updateMany({
        where: {
          clientId,
          status: EducatorWorkoutStatus.ACTIVE,
          id: { not: workoutId },
        },
        data: { status: EducatorWorkoutStatus.ARCHIVED },
      });
      await tx.educatorWorkout.update({
        where: { id: workoutId },
        data: {
          status: EducatorWorkoutStatus.ACTIVE,
          lastEditNotifiedAt: new Date(),
        },
      });
      return true;
    });
  }

  // Archives the workout only while it is active; returns whether it changed.
  async deactivate(workoutId: string): Promise<boolean> {
    const { count } = await this.prisma.educatorWorkout.updateMany({
      where: { id: workoutId, status: EducatorWorkoutStatus.ACTIVE },
      data: { status: EducatorWorkoutStatus.ARCHIVED },
    });
    return count === 1;
  }

  async delete(workoutId: string): Promise<void> {
    await this.prisma.educatorWorkout.delete({ where: { id: workoutId } });
  }

  // One draft per target, all in one transaction: either every copy exists or
  // none does.
  async copyToClients(
    copies: Array<{ clientId: string; tree: CopyTreeInput }>,
  ): Promise<Array<{ clientId: string; workoutId: string }>> {
    return await this.prisma
      .$transaction(
        copies.map(({ clientId, tree }) =>
          this.prisma.educatorWorkout.create({
            data: {
              clientId,
              status: EducatorWorkoutStatus.DRAFT,
              ...toCreateData(tree),
            },
            select: { id: true, clientId: true },
          }),
        ),
      )
      .then((rows) =>
        rows.map((row) => ({ clientId: row.clientId, workoutId: row.id })),
      );
  }

  // The 30-minute edit-notification window, claimed atomically: a single
  // conditional update, so of several simultaneous edits exactly one wins.
  async claimEditNotification(
    workoutId: string,
    now: Date,
    windowMinutes: number,
  ): Promise<boolean> {
    const threshold = new Date(now.getTime() - windowMinutes * 60_000);
    const { count } = await this.prisma.educatorWorkout.updateMany({
      where: {
        id: workoutId,
        status: EducatorWorkoutStatus.ACTIVE,
        OR: [
          { lastEditNotifiedAt: null },
          { lastEditNotifiedAt: { lt: threshold } },
        ],
      },
      data: { lastEditNotifiedAt: now },
    });
    return count === 1;
  }

  // The active workout of one record with just what a summary needs.
  async findActiveByClient(clientId: string) {
    return await this.prisma.educatorWorkout.findFirst({
      where: { clientId, status: EducatorWorkoutStatus.ACTIVE },
      select: {
        id: true,
        title: true,
        weeklyFrequency: true,
        sessions: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            name: true,
            _count: { select: { exercises: true } },
          },
        },
      },
    });
  }

  // Active workouts of every student record linked to this account.
  async findActiveByLinkedUser(userId: string) {
    return await this.prisma.educatorWorkout.findMany({
      where: {
        status: EducatorWorkoutStatus.ACTIVE,
        client: { userId },
      },
      include: {
        ...TREE_INCLUDE,
        client: {
          select: {
            professional: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }
}

export type ActiveWorkoutWithEducator = Awaited<
  ReturnType<EducatorWorkoutsRepository['findActiveByLinkedUser']>
>[number];
