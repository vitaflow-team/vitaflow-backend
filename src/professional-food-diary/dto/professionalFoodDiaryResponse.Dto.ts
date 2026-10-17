import { ApiProperty } from '@nestjs/swagger';
import { MealType } from '@prisma/client';

export class ProfessionalMealResponseDTO {
  @ApiProperty() id: string;
  @ApiProperty({ enum: MealType }) mealType: MealType;
  @ApiProperty() description: string;
  @ApiProperty() calories: number;
  @ApiProperty() loggedAt: string;
}

export class ProfessionalWaterLogResponseDTO {
  @ApiProperty() date: string;
  @ApiProperty() count: number;
}

export class ProfessionalFoodDiaryResponseDTO {
  @ApiProperty({
    description:
      'False when the Client has no linked Users account — distinct from "linked but never used the diary" (both still return 200 with empty arrays).',
  })
  hasAccount: boolean;

  @ApiProperty({ type: [ProfessionalMealResponseDTO] })
  meals: ProfessionalMealResponseDTO[];

  @ApiProperty({ type: [ProfessionalWaterLogResponseDTO] })
  waterLogs: ProfessionalWaterLogResponseDTO[];
}
