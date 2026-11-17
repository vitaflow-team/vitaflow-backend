import { PrismaService } from '@/database/prisma.service';
import { BackofficeTier, UsersToken } from '@prisma/client';
import { UserRepository } from './user.repository';

// unified-login-account UT-002, UT-003, UT-004. Built with its own Prisma
// double so the calls recorded are exactly this suite's.
describe('UserRepository — staff invitation and customer activation', () => {
  const token = { id: 'token-1', userID: 'user-1' } as UsersToken;
  const tx = {
    users: { findUnique: jest.fn(), update: jest.fn() },
    usersToken: { deleteMany: jest.fn() },
  };
  const prisma = {
    users: { findMany: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const repository = new UserRepository(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.users.update.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ id: 'user-1', ...data }),
    );
  });

  describe('acceptBackofficeInvitation', () => {
    it('UT-002: consumes the token and grants the stored pending tier in one transaction', async () => {
      tx.users.findUnique.mockResolvedValue({
        id: 'user-1',
        pendingBackofficeTier: BackofficeTier.ADMIN,
      });
      tx.usersToken.deleteMany.mockResolvedValue({ count: 1 });

      const granted = await repository.acceptBackofficeInvitation(token);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.usersToken.deleteMany).toHaveBeenCalledWith({
        where: { id: 'token-1', expiresAt: { gt: expect.any(Date) } },
      });
      expect(tx.users.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          isBackoffice: true,
          backofficeTier: BackofficeTier.ADMIN,
          pendingBackofficeTier: null,
        },
      });
      expect(granted).toMatchObject({ isBackoffice: true });
    });

    it('UT-002: a token already consumed returns null and updates nothing', async () => {
      tx.users.findUnique.mockResolvedValue({
        id: 'user-1',
        pendingBackofficeTier: BackofficeTier.EQUIPE,
      });
      tx.usersToken.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        repository.acceptBackofficeInvitation(token),
      ).resolves.toBeNull();
      expect(tx.users.update).not.toHaveBeenCalled();
    });

    it('UT-002: a withdrawn invitation returns null without consuming the token', async () => {
      tx.users.findUnique.mockResolvedValue({
        id: 'user-1',
        pendingBackofficeTier: null,
      });

      await expect(
        repository.acceptBackofficeInvitation(token),
      ).resolves.toBeNull();
      expect(tx.usersToken.deleteMany).not.toHaveBeenCalled();
      expect(tx.users.update).not.toHaveBeenCalled();
    });
  });

  describe('activateAsCustomer', () => {
    it('UT-003: stamps both consents with the current time and connects the product', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-16T12:00:00.000Z'));
      prisma.users.update.mockResolvedValue({ id: 'u1' });

      await repository.activateAsCustomer('u1', 'free-1');

      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: {
          termsAcceptedAt: new Date('2026-11-16T12:00:00.000Z'),
          healthDataConsentAt: new Date('2026-11-16T12:00:00.000Z'),
          product: { connect: { id: 'free-1' } },
        },
      });
      jest.useRealTimers();
    });
  });

  describe('findAllBackofficeStaff', () => {
    it('UT-004: lists staff rows and accounts holding a pending invitation, oldest first', async () => {
      prisma.users.findMany.mockResolvedValue([]);

      await repository.findAllBackofficeStaff();

      expect(prisma.users.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { isBackoffice: true },
            { pendingBackofficeTier: { not: null } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('setPendingBackofficeTier', () => {
    it('sets and clears the pending tier on the account', async () => {
      prisma.users.update.mockResolvedValue({ id: 'u1' });

      await repository.setPendingBackofficeTier('u1', BackofficeTier.EQUIPE);
      await repository.setPendingBackofficeTier('u1', null);

      expect(prisma.users.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'u1' },
        data: { pendingBackofficeTier: BackofficeTier.EQUIPE },
      });
      expect(prisma.users.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'u1' },
        data: { pendingBackofficeTier: null },
      });
    });
  });
});
