import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class CloneDayDTO {
  @ApiProperty({
    description:
      'A MealPlanDay id — from the current draft, or from any past PUBLISHED version of this same client.',
  })
  @IsUUID()
  sourceDayId: string;

  @ApiProperty({
    required: false,
    description:
      'Required (and must be true) when the target weekday already has meals — the API-boundary confirmation step before overwriting it.',
  })
  @IsOptional()
  @IsBoolean()
  confirmOverwrite?: boolean;
}
