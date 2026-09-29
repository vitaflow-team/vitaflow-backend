import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { TokenType } from '@prisma/client';
import { UserTokenRepository } from './userToken.repository';

describe('UserTokenRepository Tests', () => {
  let userTokenRepository: UserTokenRepository;

  const newToken = {
    userID: '1',
    type: TokenType.RECOVERY,
    tokenHash: 'hashed-token',
    expiresAt: new Date(),
  };

  const mockPrismaService = {
    $transaction: jest.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    usersToken: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'userTokenID',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest
        .fn()
        .mockImplementation(({ where: { tokenHash } }) =>
          Promise.resolve(
            tokenHash === 'hashed-token' ? { id: 'userTokenID' } : null,
          ),
        ),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserTokenRepository,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    userTokenRepository = module.get<UserTokenRepository>(UserTokenRepository);
  });

  it('replaces the same-type tokens of the user in one transaction', async () => {
    const userToken = await userTokenRepository.replace(newToken);

    expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrismaService.usersToken.deleteMany).toHaveBeenCalledWith({
      where: { userID: '1', type: TokenType.RECOVERY },
    });
    expect(mockPrismaService.usersToken.create).toHaveBeenCalledWith({
      data: newToken,
    });
    expect(userToken).toMatchObject({ id: 'userTokenID', ...newToken });
  });

  it('finds a token by its hash', async () => {
    await expect(
      userTokenRepository.findByHash('hashed-token'),
    ).resolves.toEqual({ id: 'userTokenID' });
    await expect(userTokenRepository.findByHash('other')).resolves.toBeNull();
  });

  it('deletes a token by id', async () => {
    await userTokenRepository.deleteById('userTokenID');

    expect(mockPrismaService.usersToken.deleteMany).toHaveBeenCalledWith({
      where: { id: 'userTokenID' },
    });
  });

  it('deletes all tokens matching the criteria', async () => {
    await userTokenRepository.deleteAll({ userID: '1' });

    expect(mockPrismaService.usersToken.deleteMany).toHaveBeenCalledWith({
      where: { userID: '1' },
    });
  });
});
