import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { hashToken } from '@/users/token/userToken.service';
import { TokenType, UsersToken } from '@prisma/client';

const currentDate = new Date();

const previousDate = new Date();
previousDate.setHours(previousDate.getHours() - 3);

const expiredAt = new Date();
expiredAt.setHours(expiredAt.getHours() - 1);

const liveUntil = new Date();
liveUntil.setHours(liveUntil.getHours() + 2);

// Raw values as they would appear in an email link; the rows below only
// hold their hashes, exactly like the real table.
export const userTokenRaw = {
  expiredActivation: 'userTokenMockID1',
  activation: 'userTokenMockID2',
  expiredRecovery: 'userTokenMockID3',
  recovery: 'userTokenMockID4',
};

function tokenRow(
  id: string,
  raw: string,
  fields: Pick<UsersToken, 'userID' | 'type' | 'expiresAt' | 'createdAt'>,
): UsersToken {
  return {
    id,
    tokenHash: hashToken(raw),
    updatedAt: fields.createdAt,
    ...fields,
  };
}

export const userTokenMock: UsersToken[] = [
  tokenRow('userTokenRowID1', userTokenRaw.expiredActivation, {
    userID: '1',
    type: TokenType.ACTIVATION,
    expiresAt: expiredAt,
    createdAt: previousDate,
  }),
  tokenRow('userTokenRowID2', userTokenRaw.activation, {
    userID: '2',
    type: TokenType.ACTIVATION,
    expiresAt: liveUntil,
    createdAt: currentDate,
  }),
  tokenRow('userTokenRowID3', userTokenRaw.expiredRecovery, {
    userID: '1',
    type: TokenType.RECOVERY,
    expiresAt: expiredAt,
    createdAt: previousDate,
  }),
  tokenRow('userTokenRowID4', userTokenRaw.recovery, {
    userID: '2',
    type: TokenType.RECOVERY,
    expiresAt: liveUntil,
    createdAt: currentDate,
  }),
];

export const userTokenRepositoryMock = {
  provide: UserTokenRepository,
  useValue: {
    replace: jest
      .fn()
      .mockImplementation((data: UsersToken) =>
        Promise.resolve({ ...userTokenMock[1], ...data }),
      ),
    findByHash: jest.fn().mockImplementation((tokenHash: string) => {
      const userToken = userTokenMock.find(
        (userToken) => userToken.tokenHash === tokenHash,
      );
      return Promise.resolve(userToken ?? null);
    }),
    deleteById: jest.fn().mockResolvedValue(null),
    deleteAll: jest.fn().mockResolvedValue(null),
  },
};
