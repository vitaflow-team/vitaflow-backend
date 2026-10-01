import { PrismaService } from '@/database/prisma.service';
import { MessagesRepository } from './messages.repository';

describe('MessagesRepository', () => {
  const conversationFindUnique = jest.fn();
  const conversationCreate = jest.fn();
  const conversationFindMany = jest.fn();
  const conversationUpdate = jest.fn();
  const messageCreate = jest.fn();
  const messageFindUnique = jest.fn();
  const messageFindMany = jest.fn();

  const prisma = {
    conversation: {
      findUnique: conversationFindUnique,
      create: conversationCreate,
      findMany: conversationFindMany,
      update: conversationUpdate,
    },
    message: {
      create: messageCreate,
      findUnique: messageFindUnique,
      findMany: messageFindMany,
    },
  } as unknown as PrismaService;

  const repository = new MessagesRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('findConversationByPair queries the compound (userId, professionalId) key', async () => {
    conversationFindUnique.mockResolvedValue(null);

    await repository.findConversationByPair('user-1', 'professional-1');

    expect(conversationFindUnique).toHaveBeenCalledWith({
      where: {
        userId_professionalId: {
          userId: 'user-1',
          professionalId: 'professional-1',
        },
      },
    });
  });

  it('createConversation creates for the given pair', async () => {
    conversationCreate.mockResolvedValue({});

    await repository.createConversation('user-1', 'professional-1');

    expect(conversationCreate).toHaveBeenCalledWith({
      data: { userId: 'user-1', professionalId: 'professional-1' },
    });
  });

  it('listConversationsForUser scopes to either side of the pair, newest first', async () => {
    conversationFindMany.mockResolvedValue([]);

    await repository.listConversationsForUser('user-1');

    expect(conversationFindMany).toHaveBeenCalledWith({
      where: { OR: [{ userId: 'user-1' }, { professionalId: 'user-1' }] },
      include: {
        user: { select: { id: true, name: true } },
        professional: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('setReported stamps reportedAt with the current time', async () => {
    conversationUpdate.mockResolvedValue({});

    await repository.setReported('conversation-1');

    expect(conversationUpdate).toHaveBeenCalledWith({
      where: { id: 'conversation-1' },
      data: { reportedAt: expect.any(Date) },
    });
  });

  it('createMessage persists content scoped to the conversation and sender', async () => {
    messageCreate.mockResolvedValue({});

    await repository.createMessage('conversation-1', 'user-1', 'Oi');

    expect(messageCreate).toHaveBeenCalledWith({
      data: {
        conversationId: 'conversation-1',
        senderId: 'user-1',
        content: 'Oi',
      },
    });
  });

  it('listMessages without a cursor returns the whole history oldest-first', async () => {
    messageFindMany.mockResolvedValue([]);

    await repository.listMessages('conversation-1');

    expect(messageFindMany).toHaveBeenCalledWith({
      where: { conversationId: 'conversation-1' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('listMessages with a cursor only returns messages created after it', async () => {
    messageFindMany.mockResolvedValue([]);
    const after = new Date('2026-10-01T09:00:00.000Z');

    await repository.listMessages('conversation-1', after);

    expect(messageFindMany).toHaveBeenCalledWith({
      where: { conversationId: 'conversation-1', createdAt: { gt: after } },
      orderBy: { createdAt: 'asc' },
    });
  });
});
