import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class AnswerConversationDto {
  // Absent to start a new conversation; present on every following call.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  // The free-text reply to the previous question; absent on the first call.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  answer?: string;
}
