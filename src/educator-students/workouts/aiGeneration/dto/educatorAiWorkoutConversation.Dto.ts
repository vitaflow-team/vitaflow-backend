import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class EducatorAiWorkoutConversationDTO {
  // Absent to start a new intake; present on every following call.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  // The free-text reply to the previous question; absent on the first call.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  answer?: string;

  // Read only on the call that has no `conversationId` (the start call).
  // Present = regenerate that exact draft (ADR-011); absent = create a new
  // draft on completion.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  workoutId?: string;

  // Read only alongside `workoutId` on the start call — required (and must
  // be true) when that draft was manually edited since its last generation
  // (ADR-009).
  @ApiProperty({
    required: false,
    description:
      'Required (and must be true) when the targeted draft was edited since its last generation — the confirmation step before a regenerate overwrites it.',
  })
  @IsOptional()
  @IsBoolean()
  confirmOverwrite?: boolean;
}
