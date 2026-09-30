import { PrismaService } from '@/database/prisma.service';
import { ConsentRepository } from './consent.repository';

describe('ConsentRepository', () => {
  const findUnique = jest.fn();
  const upsert = jest.fn();
  const prisma = {
    featureConsent: { findUnique, upsert },
  } as unknown as PrismaService;
  const repository = new ConsentRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('find queries by the compound userId_feature key', async () => {
    findUnique.mockResolvedValue({ id: 'consent-1' });

    const result = await repository.find('user-1', 'PROGRESS_PHOTOS');

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        userId_feature: { userId: 'user-1', feature: 'PROGRESS_PHOTOS' },
      },
    });
    expect(result).toEqual({ id: 'consent-1' });
  });

  it('create upserts so a redundant grant never conflicts', async () => {
    upsert.mockResolvedValue({ id: 'consent-1' });

    await repository.create('user-1', 'PROGRESS_PHOTOS');

    expect(upsert).toHaveBeenCalledWith({
      where: {
        userId_feature: { userId: 'user-1', feature: 'PROGRESS_PHOTOS' },
      },
      create: { userId: 'user-1', feature: 'PROGRESS_PHOTOS' },
      update: {},
    });
  });
});
