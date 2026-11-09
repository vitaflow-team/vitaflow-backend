import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class MealPlanGenerationConversationDto {
  // Absent to start a new intake; present on every following call —
  // mirrors /workouts/conversation's merged start/answer shape exactly.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  // The free-text reply to the previous question; absent on the first call.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  answer?: string;

  // Read only on the call that has no `conversationId` (the start call) —
  // required (and must be true) when the current draft already has any
  // meal on any weekday (ADR-013).
  @ApiProperty({
    required: false,
    description:
      'Required (and must be true) when the current draft already has any meal on any weekday — the confirmation step before AI generation overwrites it.',
  })
  @IsOptional()
  @IsBoolean()
  confirmOverwrite?: boolean;
}
