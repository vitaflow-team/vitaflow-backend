import { ExerciseEntity } from '@/exercise-library/exercise.entity';
import { ApiProperty } from '@nestjs/swagger';
import { FitnessGoal } from '@prisma/client';

export class WorkoutExerciseEntity {
  @ApiProperty()
  id: string;

  @ApiProperty({
    type: ExerciseEntity,
    nullable: true,
    description: 'Null when the Exercise Library removed this exercise',
  })
  exercise: ExerciseEntity | null;

  @ApiProperty()
  sets: number;

  @ApiProperty()
  reps: number;

  @ApiProperty()
  order: number;
}

export class WorkoutDayEntity {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: '1 (Mon) .. 7 (Sun)' })
  dayOfWeek: number;

  @ApiProperty({ type: [WorkoutExerciseEntity] })
  exercises: WorkoutExerciseEntity[];
}

export class WorkoutEntity {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: FitnessGoal })
  goal: FitnessGoal;

  @ApiProperty()
  daysPerWeek: number;

  @ApiProperty()
  explanation: string;

  @ApiProperty({ type: [WorkoutDayEntity] })
  days: WorkoutDayEntity[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class CurrentWorkoutResponseEntity {
  @ApiProperty({ type: WorkoutEntity, nullable: true })
  workout: WorkoutEntity | null;
}
