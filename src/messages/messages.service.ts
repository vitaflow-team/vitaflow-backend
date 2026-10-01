import { NotificationsService } from '@/notifications/notifications.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import {
  ConversationWithParticipants,
  MessagesRepository,
} from '@/repositories/messages/messages.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { Injectable } from '@nestjs/common';
import { Message } from '@prisma/client';
import { MAX_MESSAGE_LENGTH } from './messages.constants';
import { ConversationSummaryEntity, MessageEntity } from './message.entity';

const EMPTY_CONTENT = 'A mensagem não pode estar vazia.';
const CONTENT_TOO_LONG = `A mensagem pode ter no máximo ${MAX_MESSAGE_LENGTH} caracteres.`;
const NOT_ELIGIBLE =
  'Você só pode enviar mensagens para um profissional ou aluno com quem tem um vínculo ativo.';
const CONVERSATION_NOT_FOUND = 'Conversa não encontrada.';

interface EligiblePair {
  userId: string;
  professionalId: string;
}

function appUrl(path: string): string {
  return `${process.env.APP_URL ?? ''}${path}`;
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly messages: MessagesRepository,
    private readonly clients: ClientsRepository,
    private readonly users: UserRepository,
    private readonly notifications: NotificationsService,
  ) {}

  async listConversations(
    userId: string,
  ): Promise<ConversationSummaryEntity[]> {
    const rows = await this.messages.listConversationsForUser(userId);
    return rows.map((row) => this.toSummary(row, userId));
  }

  async getMessages(
    userId: string,
    conversationId: string,
    after?: string,
  ): Promise<MessageEntity[]> {
    await this.assertOwnedConversation(conversationId, userId);

    let afterCreatedAt: Date | undefined;
    if (after) {
      const afterMessage = await this.messages.findMessageById(after);
      afterCreatedAt = afterMessage?.createdAt;
    }

    const rows = await this.messages.listMessages(
      conversationId,
      afterCreatedAt,
    );
    return rows.map((row) => this.toMessageEntity(row));
  }

  // US-004's eligibility check is the sole gate: a real Client row linking
  // the two accounts (in either direction, since either side may send
  // first). An accepted ConnectionRequest from Professional Discovery
  // always produces exactly this kind of row via ClientRegisterService, so
  // this single check also correctly covers that case — no separate read
  // against ConnectionRequest is needed (TechSpec Integration Points).
  async sendMessage(
    userId: string,
    counterpartId: string,
    content: string,
  ): Promise<MessageEntity> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new AppError(EMPTY_CONTENT, 400);
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new AppError(CONTENT_TOO_LONG, 400);
    }

    const pair = await this.resolveEligiblePair(userId, counterpartId);
    if (!pair) {
      throw new AppError(NOT_ELIGIBLE, 403);
    }

    let conversation = await this.messages.findConversationByPair(
      pair.userId,
      pair.professionalId,
    );
    if (!conversation) {
      conversation = await this.messages.createConversation(
        pair.userId,
        pair.professionalId,
      );
    }

    const message = await this.messages.createMessage(
      conversation.id,
      userId,
      trimmed,
    );

    const recipientId =
      userId === pair.userId ? pair.professionalId : pair.userId;
    const sender = await this.users.findUnique({ id: userId });
    await this.notifications.create(
      recipientId,
      'MESSAGES',
      `Nova mensagem de ${sender?.name ?? 'alguém'}.`,
      appUrl('/restrict/messages'),
    );

    return this.toMessageEntity(message);
  }

  // Quiet by design (US-005.AC-2): no notification call for the reported
  // party anywhere in this method.
  async reportConversation(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    await this.assertOwnedConversation(conversationId, userId);
    await this.messages.setReported(conversationId);
  }

  private async assertOwnedConversation(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const conversation =
      await this.messages.findConversationById(conversationId);
    if (
      !conversation ||
      (conversation.userId !== userId && conversation.professionalId !== userId)
    ) {
      throw new AppError(CONVERSATION_NOT_FOUND, 404);
    }
  }

  private async resolveEligiblePair(
    callerId: string,
    counterpartId: string,
  ): Promise<EligiblePair | null> {
    const asUser = await this.clients.findByUserAndProfessional(
      callerId,
      counterpartId,
    );
    if (asUser) return { userId: callerId, professionalId: counterpartId };

    const asProfessional = await this.clients.findByUserAndProfessional(
      counterpartId,
      callerId,
    );
    if (asProfessional) {
      return { userId: counterpartId, professionalId: callerId };
    }

    return null;
  }

  private toMessageEntity(message: Message): MessageEntity {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content: message.content,
      createdAt: message.createdAt,
    };
  }

  private toSummary(
    row: ConversationWithParticipants,
    callerId: string,
  ): ConversationSummaryEntity {
    const counterpart = row.userId === callerId ? row.professional : row.user;
    const lastMessage = row.messages[0] ?? null;

    return {
      id: row.id,
      counterpart: { id: counterpart.id, name: counterpart.name },
      lastMessage: lastMessage
        ? {
            content: lastMessage.content,
            senderId: lastMessage.senderId,
            createdAt: lastMessage.createdAt,
          }
        : null,
      createdAt: row.createdAt,
    };
  }
}
