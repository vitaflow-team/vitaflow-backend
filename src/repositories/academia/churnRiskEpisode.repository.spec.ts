import { PrismaService } from '@/database/prisma.service';
import { ChurnRiskEpisodeRepository } from './churnRiskEpisode.repository';

function makePrisma() {
  return { churnRiskEpisode: { findMany: jest.fn() } };
}

function makeRepository(prisma: ReturnType<typeof makePrisma>) {
  return new ChurnRiskEpisodeRepository(prisma as unknown as PrismaService);
}

describe('ChurnRiskEpisodeRepository.findOpenByClientIds', () => {
  it('UT-017 scopes by the given client-id list, not by academia', async () => {
    const prisma = makePrisma();
    prisma.churnRiskEpisode.findMany.mockResolvedValue([
      { id: 'e1', clientId: 'a' },
    ]);
    const repository = makeRepository(prisma);

    const result = await repository.findOpenByClientIds(['a', 'b']);

    expect(prisma.churnRiskEpisode.findMany).toHaveBeenCalledWith({
      where: { endedAt: null, clientId: { in: ['a', 'b'] } },
    });
    expect(result).toEqual([{ id: 'e1', clientId: 'a' }]);
  });

  it('returns an empty array without querying when given an empty id list', async () => {
    const prisma = makePrisma();
    const repository = makeRepository(prisma);

    const result = await repository.findOpenByClientIds([]);

    expect(result).toEqual([]);
    expect(prisma.churnRiskEpisode.findMany).not.toHaveBeenCalled();
  });
});

describe('ChurnRiskEpisodeRepository.findDismissedClientIdsByIds', () => {
  it('UT-018 scopes by client-id list and reason, excluding a dismissed episode for a different reason', async () => {
    const prisma = makePrisma();
    prisma.churnRiskEpisode.findMany.mockResolvedValue([{ clientId: 'a' }]);
    const repository = makeRepository(prisma);

    const result = await repository.findDismissedClientIdsByIds(
      ['a', 'b'],
      'NO_CONTACT' as never,
    );

    expect(prisma.churnRiskEpisode.findMany).toHaveBeenCalledWith({
      where: {
        reason: 'NO_CONTACT',
        dismissedAt: { not: null },
        endedAt: null,
        clientId: { in: ['a', 'b'] },
      },
      select: { clientId: true },
    });
    expect(result).toEqual(new Set(['a']));
  });
});
