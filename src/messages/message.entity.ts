import { ApiProperty } from '@nestjs/swagger';

export class MessageEntity {
  @ApiProperty()
  id: string;

  @ApiProperty()
  conversationId: string;

  @ApiProperty({ description: 'The sending participant’s user id.' })
  senderId: string;

  @ApiProperty()
  content: string;

  @ApiProperty()
  createdAt: Date;
}

export class ConversationCounterpartEntity {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class LastMessagePreviewEntity {
  @ApiProperty()
  content: string;

  @ApiProperty()
  senderId: string;

  @ApiProperty()
  createdAt: Date;
}

export class ConversationSummaryEntity {
  @ApiProperty()
  id: string;

  @ApiProperty({
    type: ConversationCounterpartEntity,
    description:
      'The other participant — the professional for a user, the user for a professional.',
  })
  counterpart: ConversationCounterpartEntity;

  @ApiProperty({ type: LastMessagePreviewEntity, nullable: true })
  lastMessage: LastMessagePreviewEntity | null;

  @ApiProperty()
  createdAt: Date;
}
