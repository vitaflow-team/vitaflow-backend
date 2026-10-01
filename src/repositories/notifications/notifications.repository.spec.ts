import { PrismaService } from '@/database/prisma.service';
import { NotificationsRepository } from './notifications.repository';

describe('NotificationsRepository', () => {
  const create = jest.fn();
  const findUnique = jest.fn();
  const findMany = jest.fn();
  const update = jest.fn();
  const count = jest.fn();
  const upsert = jest.fn();
  const prismaNotification = { create, findUnique, findMany, update };
  const prismaPreference = { findUnique, findMany, upsert };
  const prisma = {
    notification: { ...prismaNotification, count },
    notificationPreference: prismaPreference,
  } as unknown as PrismaService;
  const repository = new NotificationsRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('create persists category/message/link scoped to the user', async () => {
    create.mockResolvedValue({ id: 'n1' });

    await repository.create('user-1', { category: 'BILLING', message: 'x' });

    expect(create).toHaveBeenCalledWith({
      data: { category: 'BILLING', message: 'x', userId: 'user-1' },
    });
  });

  it('findById delegates to findUnique', async () => {
    findUnique.mockResolvedValue({ id: 'n1' });

    const result = await repository.findById('n1');

    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'n1' } });
    expect(result).toEqual({ id: 'n1' });
  });

  it('findByUser orders newest-first with skip/take', async () => {
    findMany.mockResolvedValue([]);

    await repository.findByUser('user-1', 50, 50);

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
      skip: 50,
      take: 50,
    });
  });

  it('markRead sets readAt', async () => {
    update.mockResolvedValue({ id: 'n1', readAt: new Date() });

    await repository.markRead('n1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { readAt: expect.any(Date) },
    });
  });

  it('countUnread counts rows with a null readAt', async () => {
    count.mockResolvedValue(3);

    const result = await repository.countUnread('user-1');

    expect(count).toHaveBeenCalledWith({
      where: { userId: 'user-1', readAt: null },
    });
    expect(result).toBe(3);
  });

  it('findPreference queries the compound userId_category key', async () => {
    findUnique.mockResolvedValue({ enabled: false });

    const result = await repository.findPreference('user-1', 'BILLING');

    expect(findUnique).toHaveBeenCalledWith({
      where: { userId_category: { userId: 'user-1', category: 'BILLING' } },
    });
    expect(result).toEqual({ enabled: false });
  });

  it('findAllPreferences returns every row for the user', async () => {
    findMany.mockResolvedValue([{ category: 'BILLING', enabled: true }]);

    const result = await repository.findAllPreferences('user-1');

    expect(findMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(result).toHaveLength(1);
  });

  it('upsertPreference creates or updates the single row per (user, category)', async () => {
    upsert.mockResolvedValue({ enabled: false });

    await repository.upsertPreference('user-1', 'MESSAGES', false);

    expect(upsert).toHaveBeenCalledWith({
      where: { userId_category: { userId: 'user-1', category: 'MESSAGES' } },
      create: { userId: 'user-1', category: 'MESSAGES', enabled: false },
      update: { enabled: false },
    });
  });
});
