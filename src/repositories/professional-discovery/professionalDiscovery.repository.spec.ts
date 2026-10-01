import { PrismaService } from '@/database/prisma.service';
import { ProfessionalDiscoveryRepository } from './professionalDiscovery.repository';

describe('ProfessionalDiscoveryRepository', () => {
  const usersFindMany = jest.fn();
  const usersFindUnique = jest.fn();
  const profileUpsert = jest.fn();
  const requestFindFirst = jest.fn();
  const requestCreate = jest.fn();
  const requestFindUnique = jest.fn();
  const requestFindMany = jest.fn();
  const requestUpdateMany = jest.fn();

  const prisma = {
    users: { findMany: usersFindMany, findUnique: usersFindUnique },
    professionalProfile: { upsert: profileUpsert },
    connectionRequest: {
      findFirst: requestFindFirst,
      create: requestCreate,
      findUnique: requestFindUnique,
      findMany: requestFindMany,
      updateMany: requestUpdateMany,
    },
  } as unknown as PrismaService;

  const repository = new ProfessionalDiscoveryRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('search', () => {
    it('filters by type only when no other filter is set', async () => {
      usersFindMany.mockResolvedValue([]);

      await repository.search({ type: 'NUTRITIONIST' });

      expect(usersFindMany).toHaveBeenCalledWith({
        where: { product: { type: 'NUTRITIONIST' } },
        include: { product: true, professionalProfile: true },
        orderBy: { name: 'asc' },
      });
    });

    it('defaults to both professional types when no type filter is set', async () => {
      usersFindMany.mockResolvedValue([]);

      await repository.search({});

      expect(usersFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            product: { type: { in: ['NUTRITIONIST', 'PHYSICAL_EDUCATOR'] } },
          },
        }),
      );
    });

    it('combines price and online filters on professionalProfile', async () => {
      usersFindMany.mockResolvedValue([]);

      await repository.search({ priceMax: 200, online: true });

      expect(usersFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            professionalProfile: {
              priceFrom: { lte: 200 },
              attendsOnline: true,
            },
          }),
        }),
      );
    });

    it('matches the specialty term against name or specialty, case-insensitively', async () => {
      usersFindMany.mockResolvedValue([]);

      await repository.search({ specialty: 'nutrição' });

      expect(usersFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { name: { contains: 'nutrição', mode: 'insensitive' } },
              {
                professionalProfile: {
                  specialty: { contains: 'nutrição', mode: 'insensitive' },
                },
              },
            ],
          }),
        }),
      );
    });
  });

  it('findProfessionalById includes product and professionalProfile', async () => {
    usersFindUnique.mockResolvedValue(null);

    await repository.findProfessionalById('professional-1');

    expect(usersFindUnique).toHaveBeenCalledWith({
      where: { id: 'professional-1' },
      include: { product: true, professionalProfile: true },
    });
  });

  it('upsertProfile creates lazily or updates the single row per professional', async () => {
    profileUpsert.mockResolvedValue({});

    await repository.upsertProfile('professional-1', { bio: 'Bio' });

    expect(profileUpsert).toHaveBeenCalledWith({
      where: { userId: 'professional-1' },
      create: { userId: 'professional-1', bio: 'Bio' },
      update: { bio: 'Bio' },
    });
  });

  it('findPendingRequest scopes to the PENDING status', async () => {
    requestFindFirst.mockResolvedValue(null);

    await repository.findPendingRequest('user-1', 'professional-1');

    expect(requestFindFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        professionalId: 'professional-1',
        status: 'PENDING',
      },
    });
  });

  it('createRequest creates a request for the pair', async () => {
    requestCreate.mockResolvedValue({});

    await repository.createRequest('user-1', 'professional-1');

    expect(requestCreate).toHaveBeenCalledWith({
      data: { userId: 'user-1', professionalId: 'professional-1' },
    });
  });

  it('listByUser includes the professional name, newest first', async () => {
    requestFindMany.mockResolvedValue([]);

    await repository.listByUser('user-1');

    expect(requestFindMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      include: { professional: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('listIncomingPending scopes to this professional’s PENDING requests', async () => {
    requestFindMany.mockResolvedValue([]);

    await repository.listIncomingPending('professional-1');

    expect(requestFindMany).toHaveBeenCalledWith({
      where: { professionalId: 'professional-1', status: 'PENDING' },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('transitionIfPending conditionally flips status and returns the affected row count', async () => {
    requestUpdateMany.mockResolvedValue({ count: 1 });

    const result = await repository.transitionIfPending(
      'request-1',
      'professional-1',
      'ACCEPTED',
    );

    expect(requestUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'request-1',
        professionalId: 'professional-1',
        status: 'PENDING',
      },
      data: { status: 'ACCEPTED', decidedAt: expect.any(Date) },
    });
    expect(result).toBe(1);
  });

  it('transitionIfPending returns 0 when the request is no longer PENDING', async () => {
    requestUpdateMany.mockResolvedValue({ count: 0 });

    const result = await repository.transitionIfPending(
      'request-1',
      'professional-1',
      'DECLINED',
    );

    expect(result).toBe(0);
  });
});
