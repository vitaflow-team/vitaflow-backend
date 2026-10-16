import { ApiProperty } from '@nestjs/swagger';

export class NutritionistPatientResponseDTO {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty() phone: string;
  @ApiProperty() hasAccount: boolean;
  @ApiProperty({ nullable: true, type: String }) userId: string | null;
  @ApiProperty() createdAt: string;
}

export class NutritionistPatientListItemDTO {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty() hasAccount: boolean;
}

export class NutritionistPatientListResponseDTO {
  @ApiProperty({ type: [NutritionistPatientListItemDTO] })
  items: NutritionistPatientListItemDTO[];
  @ApiProperty() total: number;
}
