import { ApiProperty } from '@nestjs/swagger';
import { MealType } from '@prisma/client';

export class MealEntity {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: MealType })
  mealType: MealType;

  @ApiProperty()
  description: string;

  @ApiProperty({ description: 'Estimated or user-edited value, in kcal.' })
  calories: number;

  @ApiProperty()
  loggedAt: Date;
}

export class DailySummaryEntity {
  @ApiProperty({ type: [MealEntity] })
  meals: MealEntity[];

  @ApiProperty()
  totalCalories: number;

  @ApiProperty({
    nullable: true,
    description: 'Null until sex/goal/weight/height are all known.',
  })
  goal: number | null;

  @ApiProperty()
  waterCount: number;

  @ApiProperty()
  streak: number;
}
