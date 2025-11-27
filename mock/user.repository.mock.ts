import { UserRepository } from '@/repositories/users/user.repository';
import { Prisma, Users } from '@prisma/client';

export const userMock = [
  {
    id: '1',
    name: 'Jonh Doe',
    email: 'jonhdoe@jonhdoe.com',
    password: '12345',
    avatar: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: '2',
    name: 'Jonh Doe',
    email: 'jonhdoe1@jonhdoe.com',
    password: '12345',
    avatar: null,
    active: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
] as Users[];

export const userRepositoryMock = {
  provide: UserRepository,
  useValue: {
    create: jest.fn().mockImplementation((data: Prisma.UsersCreateInput) => {
      return Promise.resolve({
        id: 'idNewUser',
        name: data.name,
        email: data.email,
        password: data.password,
        avatar: data.avatar ?? null,
        active: data.active ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } satisfies Users);
    }),
    findByEmail: jest.fn().mockImplementation(({ email }) => {
      const user = userMock.filter((user) => {
        if (user.email === email) {
          return user;
        }
      });
      if (user[0]) {
        return Promise.resolve(user[0]);
      } else {
        return Promise.resolve(null);
      }
    }),
    activateUser: jest.fn().mockImplementation((user: Users) => {
      return Promise.resolve({
        ...user,
        active: true,
        updatedAt: new Date(),
      } as Users);
    }),
  },
};
