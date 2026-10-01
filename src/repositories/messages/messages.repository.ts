import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { Conversation, Message, Users } from '@prisma/client';

export type ConversationWithParticipants = Conversation & {
  user: Pick<Users, 'id' | 'name'>;
  professional: Pick<Users, 'id' | 'name'>;
  messages: Message[];
};

@Injectable()
export class MessagesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findConversationByPair(
    userId: string,
    professionalId: string,
  ): Promise<Conversation | null> {
    return await this.prisma.conversation.findUnique({
      where: { userId_professionalId: { userId, professionalId } },
    });
  }

  async createConversation(
    userId: string,
    professionalId: string,
  ): Promise<Conversation> {
    return await this.prisma.conversation.create({
      data: { userId, professionalId },
    });
  }

  async findConversationById(id: string): Promise<Conversation | null> {
    return await this.prisma.conversation.findUnique({ where: { id } });
  }

  // One row per conversation the caller participates in (either side),
  // newest activity first, each with its own last-message preview.
  async listConversationsForUser(
    userId: string,
  ): Promise<ConversationWithParticipants[]> {
    return await this.prisma.conversation.findMany({
      where: { OR: [{ userId }, { professionalId: userId }] },
      include: {
        user: { select: { id: true, name: true } },
        professional: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setReported(id: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id },
      data: { reportedAt: new Date() },
    });
  }

  async createMessage(
    conversationId: string,
    senderId: string,
    content: string,
  ): Promise<Message> {
    return await this.prisma.message.create({
      data: { conversationId, senderId, content },
    });
  }

  async findMessageById(id: string): Promise<Message | null> {
    return await this.prisma.message.findUnique({ where: { id } });
  }

  async listMessages(conversationId: string, after?: Date): Promise<Message[]> {
    return await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(after ? { createdAt: { gt: after } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
