import { UserRepository } from '@/repositories/users/user.repository';
import { ProfileAddressDTO } from '@/users/profile/profileAddress.Dto';
import { Prisma, Users } from '@prisma/client';

export const userMock = [
  {
    id: '1',
    name: 'Jonh Doe',
    email: 'jonhdoe@jonhdoe.com',
    password: '12345',
    avatar: null,
    active: true,
    birthDate: new Date('1990-05-20'),
    phone: '999999999',
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
    birthDate: new Date('1990-05-20'),
    phone: '999999999',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: '3',
    name: 'Jonh Doe',
    email: 'jonhdoeActive@jonhdoe.com',
    password: '12345',
    avatar: null,
    active: true,
    birthDate: new Date('1990-05-20'),
    phone: '999999999',
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
        termsAcceptedAt: (data.termsAcceptedAt as Date | null) ?? null,
        healthDataConsentAt: (data.healthDataConsentAt as Date | null) ?? null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        subscriptionStatus: null,
        subscriptionCancelAt: null,
        subscriptionCurrentPeriodEnd: null,
        birthDate: new Date('1990-05-20'),
        phone: '999999999',
        createdAt: new Date(),
        updatedAt: new Date(),
        productId: null,
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
    updatePassword: jest.fn(),
    deleteAccount: jest.fn().mockResolvedValue(undefined),
    findUnique: jest.fn().mockImplementation(({ id }) => {
      const user = userMock.filter((user) => {
        if (user.id === id) {
          return user;
        }
      });
      if (user[0]) {
        return Promise.resolve(user[0]);
      } else {
        return Promise.resolve(null);
      }
    }),
    updateUserProfile: jest
      .fn()
      .mockImplementation(
        async (
          id: string,
          userData: Prisma.UsersUpdateInput,
          address?: ProfileAddressDTO,
        ): Promise<Users & { address: ProfileAddressDTO | null }> => {
          const baseUser = userMock.find((u) => u.id === id);

          const updatedUser = {
            ...baseUser,
            ...(userData as Users),
          };

          if (address) {
            const mockedAddress = {
              id: 'newIdAddress',
              userID: updatedUser.id,
              addressLine1: address.addressLine1,
              addressLine2: address.addressLine2,
              district: address.district,
              city: address.city,
              region: address.region,
              postalCode: address.postalCode,
            };

            return Promise.resolve({
              ...updatedUser,
              address: mockedAddress,
            });
          }

          return Promise.resolve({
            ...updatedUser,
            address: null,
          });
        },
      ),
    getUserProfile: jest.fn().mockImplementation((id) => {
      const user = userMock.filter((user) => {
        if (user.id === id) {
          return user;
        }
      });
      if (user[0]) {
        return Promise.resolve(user[0]);
      } else {
        return Promise.resolve(null);
      }
    }),
    findByStripeCustomerId: jest
      .fn()
      .mockImplementation((stripeCustomerId: string) => {
        const user = userMock.find(
          (user) =>
            (user as Users & { stripeCustomerId?: string }).stripeCustomerId ===
            stripeCustomerId,
        );
        return Promise.resolve(user ?? null);
      }),
    updateSubscription: jest
      .fn()
      .mockImplementation((id: string, data: Record<string, unknown>) => {
        const baseUser = userMock.find((u) => u.id === id);
        return Promise.resolve({
          ...baseUser,
          ...data,
          product: null,
        });
      }),
  },
};
