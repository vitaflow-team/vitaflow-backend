import { ApiProperty } from '@nestjs/swagger';

export class ConversationTurnEntity {
  @ApiProperty()
  conversationId: string;

  @ApiProperty({
    nullable: true,
    example: 'goal',
    description: 'Next field to ask about; null once the conversation is done',
  })
  field: string | null;

  @ApiProperty()
  question: string;

  @ApiProperty()
  done: boolean;

  @ApiProperty({
    description: 'True when the previous answer could not be parsed',
  })
  reprompt: boolean;
}
