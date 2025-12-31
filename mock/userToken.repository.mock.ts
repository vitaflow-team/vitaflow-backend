import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { UsersToken } from '@prisma/client';

const currentDate = new Date();

const previousDate = new Date();
previousDate.setHours(previousDate.getHours() - 3);

export const userTokenMock = [
  {
    id: 'userTokenMockID1',
    userID: '1',
    createdAt: previousDate,
    updatedAt: previousDate,
  },
  {
    id: 'userTokenMockID2',
    userID: '2',
    createdAt: currentDate,
    updatedAt: currentDate,
  },
] as UsersToken[];

export const userTokenRepositoryMock = {
  provide: UserTokenRepository,
  useValue: {
    create: jest
      .fn()
      .mockResolvedValue(({ id }) =>
        Promise.resolve({ ...userTokenMock[0], userID: id }),
      ),
    deleteAll: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockImplementation(({ id }) => {
      const userToken = userTokenMock.filter((userToken) => {
        if (userToken.id === id) {
          return userToken;
        }
      });
      if (userToken[0]) {
        return Promise.resolve(userToken[0]);
      } else {
        return Promise.resolve(null);
      }
    }),
  },
};
