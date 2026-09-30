import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const WORKOUT_INCLUDE = {
  days: {
    include: {
      // `exercise` is optional: the Exercise Library backoffice can delete
      // an exercise at any time; a null here means "unavailable," not an
      // error (UT-019) — see WorkoutExercise.exerciseId's SetNull FK.
      exercises: {
        include: { exercise: true },
        orderBy: { order: 'asc' as const },
      },
    },
    orderBy: { dayOfWeek: 'asc' as const },
  },
} satisfies Prisma.WorkoutInclude;

export type WorkoutWithDetails = Prisma.WorkoutGetPayload<{
  include: typeof WORKOUT_INCLUDE;
}>;

export interface WorkoutDayInput {
  dayOfWeek: number;
  exercises: {
    exerciseId: string;
    sets: number;
    reps: number;
    order: number;
  }[];
}

export interface WorkoutInput {
  goal: Prisma.WorkoutUncheckedCreateInput['goal'];
  daysPerWeek: number;
  explanation: string;
  days: WorkoutDayInput[];
}

const EXERCISE_CONTEXT_INCLUDE = {
  workoutDay: {
    include: {
      workout: true,
      _count: { select: { exercises: true } },
    },
  },
} satisfies Prisma.WorkoutExerciseInclude;

export type WorkoutExerciseWithContext = Prisma.WorkoutExerciseGetPayload<{
  include: typeof EXERCISE_CONTEXT_INCLUDE;
}>;

export interface UpdateWorkoutExerciseData {
  exerciseId?: string;
  sets?: number;
  reps?: number;
}

@Injectable()
export class WorkoutsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findCurrentByUserId(
    userId: string,
  ): Promise<WorkoutWithDetails | null> {
    return await this.prisma.workout.findFirst({
      where: { userId },
      include: WORKOUT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async existsForUser(userId: string): Promise<boolean> {
    const count = await this.prisma.workout.count({ where: { userId } });
    return count > 0;
  }

  // A user has at most one current Workout (no history, per this PRD's
  // Non-Goals), so replacing means deleting any prior one and creating the
  // new one atomically.
  async replace(
    userId: string,
    data: WorkoutInput,
  ): Promise<WorkoutWithDetails> {
    const [, workout] = await this.prisma.$transaction([
      this.prisma.workout.deleteMany({ where: { userId } }),
      this.prisma.workout.create({
        data: {
          userId,
          goal: data.goal,
          daysPerWeek: data.daysPerWeek,
          explanation: data.explanation,
          days: {
            create: data.days.map((day) => ({
              dayOfWeek: day.dayOfWeek,
              exercises: {
                create: day.exercises.map((exercise) => ({
                  exerciseId: exercise.exerciseId,
                  sets: exercise.sets,
                  reps: exercise.reps,
                  order: exercise.order,
                })),
              },
            })),
          },
        },
        include: WORKOUT_INCLUDE,
      }),
    ]);
    return workout;
  }

  async delete(userId: string): Promise<void> {
    await this.prisma.workout.deleteMany({ where: { userId } });
  }

  async findExerciseContext(
    workoutExerciseId: string,
  ): Promise<WorkoutExerciseWithContext | null> {
    return await this.prisma.workoutExercise.findUnique({
      where: { id: workoutExerciseId },
      include: EXERCISE_CONTEXT_INCLUDE,
    });
  }

  async updateExerciseRow(
    workoutExerciseId: string,
    data: UpdateWorkoutExerciseData,
  ): Promise<void> {
    await this.prisma.workoutExercise.update({
      where: { id: workoutExerciseId },
      data,
    });
  }

  async deleteExerciseRow(workoutExerciseId: string): Promise<void> {
    await this.prisma.workoutExercise.delete({
      where: { id: workoutExerciseId },
    });
  }
}
