import { PrismaService } from '@/database/prisma.service';
import { OAuthIdentity } from '@prisma/client';
import { OAuthIdentityRepository } from './oauthIdentity.repository';

describe('OAuthIdentityRepository', () => {
  let rows: OAuthIdentity[];
  let repository: OAuthIdentityRepository;

  beforeEach(() => {
    rows = [];
    const prisma = {
      oAuthIdentity: {
        create: jest.fn().mockImplementation(({ data }) => {
          if (
            rows.some(
              (row) =>
                row.provider === data.provider &&
                (row.providerAccountId === data.providerAccountId ||
                  row.userId === data.userId),
            )
          ) {
            return Promise.reject(
              Object.assign(new Error('unique constraint'), { code: 'P2002' }),
            );
          }
          const row: OAuthIdentity = {
            id: `identity-${rows.length + 1}`,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          rows.push(row);
          return Promise.resolve(row);
        }),
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.provider_providerAccountId) {
            return Promise.resolve(
              rows.find(
                (row) =>
                  row.provider === where.provider_providerAccountId.provider &&
                  row.providerAccountId ===
                    where.provider_providerAccountId.providerAccountId,
              ) ?? null,
            );
          }
          return Promise.resolve(
            rows.find(
              (row) =>
                row.provider === where.provider_userId.provider &&
                row.userId === where.provider_userId.userId,
            ) ?? null,
          );
        }),
      },
    };
    repository = new OAuthIdentityRepository(
      prisma as unknown as PrismaService,
    );
  });

  it('UT-023 creates a row retrievable by provider account', async () => {
    await repository.create({
      provider: 'google',
      providerAccountId: 'sub-1',
      userId: 'user-1',
    });

    await expect(
      repository.findByProviderAccount('google', 'sub-1'),
    ).resolves.toEqual(expect.objectContaining({ userId: 'user-1' }));
  });

  it('UT-024 surfaces a duplicate provider account unique violation', async () => {
    await repository.create({
      provider: 'google',
      providerAccountId: 'sub-1',
      userId: 'user-1',
    });

    await expect(
      repository.create({
        provider: 'google',
        providerAccountId: 'sub-1',
        userId: 'user-2',
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('UT-025 returns null for an unknown provider account', async () => {
    await expect(
      repository.findByProviderAccount('google', 'unknown-sub'),
    ).resolves.toBeNull();
  });
});
