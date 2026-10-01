import { NotificationsService } from '@/notifications/notifications.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { MessagesRepository } from '@/repositories/messages/messages.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { Test, TestingModule } from '@nestjs/testing';
import { Client, Conversation, Message } from '@prisma/client';
import { MessagesService } from './messages.service';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    userId: 'user-1',
    professionalId: 'professional-1',
    reportedAt: null,
    createdAt: new Date('2026-10-01T09:00:00.000Z'),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    senderId: 'user-1',
    content: 'Oi, tudo bem?',
    createdAt: new Date('2026-10-01T09:00:00.000Z'),
    ...overrides,
  };
}

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 'client-1',
    name: 'Usuária',
    email: 'user@example.com',
    phone: '',
    userId: 'user-1',
    birthDate: null,
    professionalId: 'professional-1',
    createdAt: new Date('2026-10-01T09:00:00.000Z'),
    updatedAt: new Date('2026-10-01T09:00:00.000Z'),
    ...overrides,
  };
}

describe('MessagesService', () => {
  const messagesFindConversationByPair = jest.fn();
  const messagesCreateConversation = jest.fn();
  const messagesFindConversationById = jest.fn();
  const messagesListConversationsForUser = jest.fn();
  const messagesSetReported = jest.fn();
  const messagesCreateMessage = jest.fn();
  const messagesFindMessageById = jest.fn();
  const messagesListMessages = jest.fn();
  const clientsFindByUserAndProfessional = jest.fn();
  const usersFindUnique = jest.fn();
  const notificationsCreate = jest.fn();

  let service: MessagesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        {
          provide: MessagesRepository,
          useValue: {
            findConversationByPair: messagesFindConversationByPair,
            createConversation: messagesCreateConversation,
            findConversationById: messagesFindConversationById,
            listConversationsForUser: messagesListConversationsForUser,
            setReported: messagesSetReported,
            createMessage: messagesCreateMessage,
            findMessageById: messagesFindMessageById,
            listMessages: messagesListMessages,
          },
        },
        {
          provide: ClientsRepository,
          useValue: {
            findByUserAndProfessional: clientsFindByUserAndProfessional,
          },
        },
        { provide: UserRepository, useValue: { findUnique: usersFindUnique } },
        {
          provide: NotificationsService,
          useValue: { create: notificationsCreate },
        },
      ],
    }).compile();

    service = module.get(MessagesService);
    usersFindUnique.mockResolvedValue({ id: 'user-1', name: 'Usuária' });
    notificationsCreate.mockResolvedValue(undefined);
  });

  describe('sendMessage', () => {
    it('UT-001 creates the Conversation (none exists yet) and the Message for an eligible pair', async () => {
      clientsFindByUserAndProfessional.mockImplementation((userId: string) =>
        Promise.resolve(userId === 'user-1' ? makeClient() : null),
      );
      messagesFindConversationByPair.mockResolvedValue(null);
      messagesCreateConversation.mockResolvedValue(makeConversation());
      messagesCreateMessage.mockResolvedValue(makeMessage());

      const result = await service.sendMessage(
        'user-1',
        'professional-1',
        'Oi, tudo bem?',
      );

      expect(messagesCreateConversation).toHaveBeenCalledWith(
        'user-1',
        'professional-1',
      );
      expect(messagesCreateMessage).toHaveBeenCalledWith(
        'conversation-1',
        'user-1',
        'Oi, tudo bem?',
      );
      expect(result.content).toBe('Oi, tudo bem?');
    });

    it('reuses an existing Conversation instead of creating a second one', async () => {
      clientsFindByUserAndProfessional.mockImplementation((userId: string) =>
        Promise.resolve(userId === 'user-1' ? makeClient() : null),
      );
      messagesFindConversationByPair.mockResolvedValue(makeConversation());
      messagesCreateMessage.mockResolvedValue(makeMessage());

      await service.sendMessage('user-1', 'professional-1', 'Oi de novo');

      expect(messagesCreateConversation).not.toHaveBeenCalled();
    });

    it('UT-002 rejects an empty (or whitespace-only) message', async () => {
      await expect(
        service.sendMessage('user-1', 'professional-1', ''),
      ).rejects.toThrow(AppError);
      await expect(
        service.sendMessage('user-1', 'professional-1', '   '),
      ).rejects.toThrow(AppError);
      expect(messagesCreateMessage).not.toHaveBeenCalled();
    });

    it('UT-003 rejects a message past the defined length limit', async () => {
      const tooLong = 'a'.repeat(2001);

      await expect(
        service.sendMessage('user-1', 'professional-1', tooLong),
      ).rejects.toThrow(AppError);
      expect(messagesCreateMessage).not.toHaveBeenCalled();
    });

    // Rate limiting is enforced by `DualBucketThrottlerGuard` at the
    // controller level (TechSpec Integration Points), not duplicated inside
    // the service — a "bespoke mechanism" the TechSpec explicitly rejects.
    // This proves the service itself carries no internal throttle state;
    // the real 429 boundary is IT-002, against the actual guard/HTTP layer.
    it('UT-004 carries no internal rate-limit state — repeated sends each succeed independently', async () => {
      clientsFindByUserAndProfessional.mockImplementation((userId: string) =>
        Promise.resolve(userId === 'user-1' ? makeClient() : null),
      );
      messagesFindConversationByPair.mockResolvedValue(makeConversation());
      messagesCreateMessage.mockResolvedValue(makeMessage());

      for (let index = 0; index < 25; index += 1) {
        await expect(
          service.sendMessage('user-1', 'professional-1', `mensagem ${index}`),
        ).resolves.toBeDefined();
      }
      expect(messagesCreateMessage).toHaveBeenCalledTimes(25);
    });

    it('UT-008a rejects when no Client row exists in either direction (no relationship at all)', async () => {
      clientsFindByUserAndProfessional.mockResolvedValue(null);

      await expect(
        service.sendMessage('user-1', 'professional-1', 'Oi'),
      ).rejects.toThrow(AppError);
      try {
        await service.sendMessage('user-1', 'professional-1', 'Oi');
      } catch (error) {
        expect((error as AppError).getStatus()).toBe(403);
      }
    });

    it('UT-008b rejects when the only Client row has a null userId (never linked)', async () => {
      // A Client row with userId: null can never itself be the `callerId` of
      // a request (there is no account to authenticate as), so this is
      // exercised exactly like "no relationship": the lookup for this
      // specific (callerId, counterpartId) pair finds nothing.
      clientsFindByUserAndProfessional.mockResolvedValue(null);

      await expect(
        service.sendMessage('professional-1', 'some-unlinked-contact', 'Oi'),
      ).rejects.toThrow(AppError);
    });

    it('UT-008c rejects when only a PENDING connection request exists (no accepted Client row yet)', async () => {
      // A PENDING-only ConnectionRequest never produces a Client row, so
      // this hits the identical "no relationship" path.
      clientsFindByUserAndProfessional.mockResolvedValue(null);

      await expect(
        service.sendMessage('user-1', 'professional-1', 'Oi'),
      ).rejects.toThrow(AppError);
    });

    it('UT-009 succeeds once a real Client row links the two accounts', async () => {
      clientsFindByUserAndProfessional.mockImplementation(
        (userId: string, professionalId: string) =>
          Promise.resolve(
            userId === 'user-1' && professionalId === 'professional-1'
              ? makeClient()
              : null,
          ),
      );
      messagesFindConversationByPair.mockResolvedValue(null);
      messagesCreateConversation.mockResolvedValue(makeConversation());
      messagesCreateMessage.mockResolvedValue(makeMessage());

      await expect(
        service.sendMessage('user-1', 'professional-1', 'Agora dá'),
      ).resolves.toBeDefined();
    });

    it('UT-012 notifies the recipient through the Notifications feature', async () => {
      clientsFindByUserAndProfessional.mockImplementation((userId: string) =>
        Promise.resolve(userId === 'user-1' ? makeClient() : null),
      );
      messagesFindConversationByPair.mockResolvedValue(makeConversation());
      messagesCreateMessage.mockResolvedValue(makeMessage());

      await service.sendMessage('user-1', 'professional-1', 'Oi');

      expect(notificationsCreate).toHaveBeenCalledWith(
        'professional-1',
        'MESSAGES',
        expect.any(String),
        expect.any(String),
      );
    });

    it('notifies the sender when the professional is the one sending', async () => {
      clientsFindByUserAndProfessional.mockImplementation((userId: string) =>
        Promise.resolve(userId === 'professional-1' ? makeClient() : null),
      );
      messagesFindConversationByPair.mockResolvedValue(makeConversation());
      messagesCreateMessage.mockResolvedValue(
        makeMessage({ senderId: 'professional-1' }),
      );

      await service.sendMessage('professional-1', 'user-1', 'Oi');

      expect(notificationsCreate).toHaveBeenCalledWith(
        'user-1',
        'MESSAGES',
        expect.any(String),
        expect.any(String),
      );
    });

    it('UT-013 still creates and returns the message when the recipient’s notification call resolves (preference-gating is internal to Notifications)', async () => {
      clientsFindByUserAndProfessional.mockImplementation((userId: string) =>
        Promise.resolve(userId === 'user-1' ? makeClient() : null),
      );
      messagesFindConversationByPair.mockResolvedValue(makeConversation());
      messagesCreateMessage.mockResolvedValue(makeMessage());
      messagesListMessages.mockResolvedValue([makeMessage()]);
      messagesFindConversationById.mockResolvedValue(makeConversation());

      const sent = await service.sendMessage('user-1', 'professional-1', 'Oi');
      expect(sent.content).toBe('Oi, tudo bem?');

      const history = await service.getMessages('user-1', 'conversation-1');
      expect(history).toHaveLength(1);
    });
  });

  describe('getMessages', () => {
    beforeEach(() => {
      messagesFindConversationById.mockResolvedValue(makeConversation());
    });

    it('UT-005 returns only messages created after the given cursor', async () => {
      const cursorMessage = makeMessage({
        id: 'seen-1',
        createdAt: new Date('2026-10-01T09:00:00.000Z'),
      });
      messagesFindMessageById.mockResolvedValue(cursorMessage);
      messagesListMessages.mockResolvedValue([
        makeMessage({
          id: 'new-1',
          createdAt: new Date('2026-10-01T09:05:00.000Z'),
        }),
      ]);

      const result = await service.getMessages(
        'user-1',
        'conversation-1',
        'seen-1',
      );

      expect(messagesListMessages).toHaveBeenCalledWith(
        'conversation-1',
        cursorMessage.createdAt,
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('new-1');
    });

    it('UT-006 returns full history oldest-first when no cursor is given', async () => {
      messagesListMessages.mockResolvedValue([
        makeMessage({
          id: 'a',
          createdAt: new Date('2026-10-01T09:00:00.000Z'),
        }),
        makeMessage({
          id: 'b',
          createdAt: new Date('2026-10-01T09:05:00.000Z'),
        }),
      ]);

      const result = await service.getMessages('user-1', 'conversation-1');

      expect(messagesListMessages).toHaveBeenCalledWith(
        'conversation-1',
        undefined,
      );
      expect(result.map((m) => m.id)).toEqual(['a', 'b']);
    });

    it('UT-007 returns [] for a conversation with no messages yet', async () => {
      messagesListMessages.mockResolvedValue([]);

      const result = await service.getMessages('user-1', 'conversation-1');

      expect(result).toEqual([]);
    });

    it('throws AppError(404) when the caller does not participate in the conversation', async () => {
      messagesFindConversationById.mockResolvedValue(
        makeConversation({
          userId: 'someone-else',
          professionalId: 'professional-1',
        }),
      );

      await expect(
        service.getMessages('user-1', 'conversation-1'),
      ).rejects.toThrow(AppError);
    });
  });

  describe('reportConversation', () => {
    beforeEach(() => {
      messagesFindConversationById.mockResolvedValue(makeConversation());
    });

    it('UT-010 sets reportedAt without notifying the counterpart', async () => {
      await service.reportConversation('user-1', 'conversation-1');

      expect(messagesSetReported).toHaveBeenCalledWith('conversation-1');
      expect(notificationsCreate).not.toHaveBeenCalled();
    });

    it('UT-011 a second report call does not error (idempotent, overwrite semantics)', async () => {
      await service.reportConversation('user-1', 'conversation-1');
      await expect(
        service.reportConversation('user-1', 'conversation-1'),
      ).resolves.toBeUndefined();
      expect(messagesSetReported).toHaveBeenCalledTimes(2);
    });

    it('throws AppError(404) when the caller does not participate in the conversation', async () => {
      messagesFindConversationById.mockResolvedValue(
        makeConversation({
          userId: 'someone-else',
          professionalId: 'professional-1',
        }),
      );

      await expect(
        service.reportConversation('user-1', 'conversation-1'),
      ).rejects.toThrow(AppError);
    });
  });

  describe('listConversations', () => {
    it('UT-014 returns [] for zero eligible relationships', async () => {
      messagesListConversationsForUser.mockResolvedValue([]);

      const result = await service.listConversations('user-1');

      expect(result).toEqual([]);
    });

    it('maps the counterpart to the other side regardless of which side the caller is', async () => {
      messagesListConversationsForUser.mockResolvedValue([
        {
          ...makeConversation(),
          user: { id: 'user-1', name: 'Usuária' },
          professional: { id: 'professional-1', name: 'Dra. Ana' },
          messages: [makeMessage()],
        },
      ]);

      const asUser = await service.listConversations('user-1');
      expect(asUser[0].counterpart).toEqual({
        id: 'professional-1',
        name: 'Dra. Ana',
      });

      const asProfessional = await service.listConversations('professional-1');
      expect(asProfessional[0].counterpart).toEqual({
        id: 'user-1',
        name: 'Usuária',
      });
    });
  });
});
