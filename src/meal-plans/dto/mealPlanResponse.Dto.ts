import { ApiProperty } from '@nestjs/swagger';
import { Weekday } from '@prisma/client';

export class MealPlanMealResponseDTO {
  @ApiProperty() id: string;
  @ApiProperty() label: string;
  @ApiProperty() text: string;
}

export class MealPlanDayResponseDTO {
  @ApiProperty({
    description:
      "The MealPlanDay id — pass as cloneDay()'s sourceDayId to clone this day elsewhere.",
  })
  id: string;
  @ApiProperty({ enum: Weekday }) weekday: Weekday;
  @ApiProperty({ type: [MealPlanMealResponseDTO] })
  meals: MealPlanMealResponseDTO[];
}

export class MealPlanDraftResponseDTO {
  @ApiProperty() id: string;
  @ApiProperty({ type: [MealPlanDayResponseDTO] })
  days: MealPlanDayResponseDTO[];
}

export class MealPlanVersionResponseDTO {
  @ApiProperty() version: number;
  @ApiProperty() publishedAt: string;
}
