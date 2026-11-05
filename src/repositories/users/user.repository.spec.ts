import { PrismaService } from '@/database/prisma.service';
import { ProfileAddressDTO } from '@/users/profile/profileAddress.Dto';
import { startOfMonth, startOfNextMonth } from '@/utils/monthRange';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, ProductTier, ProductType, Users } from '@prisma/client';
import { userMock } from 'mock/user.repository.mock';
import { UserRepository } from './user.repository';

describe('UserRepository Tests', () => {
  let userRepository: UserRepository;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRepository,
        {
          provide: PrismaService,
          useValue: {
            users: {
              create: jest
                .fn()
                .mockImplementation(
                  ({ data }: { data: Prisma.UsersCreateInput }) => {
                    return Promise.resolve({
                      id: 'idNewUser',
                      name: data.name,
                      email: data.email,
                      password: data.password,
                      phone: data.phone ?? null,
                      birthDate: new Date('1990-05-20'),
                      avatar: data.avatar ?? null,
                      active: data.active ?? false,
                      termsAcceptedAt:
                        (data.termsAcceptedAt as Date | null) ?? null,
                      healthDataConsentAt:
                        (data.healthDataConsentAt as Date | null) ?? null,
                      asaasCustomerId: null,
                      asaasSubscriptionId: null,
                      subscriptionStatus: null,
                      subscriptionCancelAt: null,
                      subscriptionCurrentPeriodEnd: null,
                      productId: null,
                      academiaId: null,
                      isBackoffice: false,
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    } satisfies Users);
                  },
                ),
              update: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn().mockImplementation(({ where }) => {
                const user = userMock.filter((user) => {
                  if (user.id === where.id) {
                    return user;
                  }
                });
                if (user[0]) {
                  return Promise.resolve(user[0]);
                } else {
                  return Promise.resolve(null);
                }
              }),
            },
            $transaction: jest
              .fn()
              .mockImplementation(
                async (
                  callback: (
                    tx: any,
                  ) => Promise<Users & { address: ProfileAddressDTO | null }>,
                ): Promise<Users & { address: ProfileAddressDTO | null }> => {
                  const tx = {
                    users: {
                      update: jest
                        .fn()
                        .mockImplementation(({ where, data }) => {
                          const baseUser = userMock.find(
                            (u) => u.id === where.id,
                          );

                          const updatedUser = {
                            ...baseUser,
                            ...data,
                          };
                          return Promise.resolve(updatedUser);
                        }),
                    },
                    userAddress: {
                      upsert: jest
                        .fn()
                        .mockImplementation(({ where, address }) => {
                          if (!address) return Promise.resolve(undefined);

                          return Promise.resolve({
                            ...address,
                            id: 'newIdAddress',
                            userID: where.id,
                          });
                        }),
                    },
                  };

                  const result = await callback(tx);

                  return result;
                },
              ),
          },
        },
      ],
    }).compile();

    userRepository = module.get<UserRepository>(UserRepository);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined and instantiated', () => {
    expect(userRepository).toBeDefined();
  });

  it('Create user', async () => {
    const userData: Prisma.UsersCreateInput = {
      email: 'newjonhdoe@jonhdoe.com',
      password: 'jonhdoe1234',
      name: 'Jonh Doe New User',
      active: false,
    };

    const newUser = await userRepository.create(userData);

    expect(newUser.id).toBeDefined();
    expect(newUser.id).toEqual('idNewUser');
  });

  it('Find user by e-mail', async () => {
    const userData: Users = {
      id: 'userID',
      email: 'jonhdoe@jonhdoe.com',
      password: 'jonhdoe1234',
      name: 'Jonh Doe New User',
      phone: null,
      birthDate: new Date('1990-05-20'),
      active: true,
      avatar: null,
      productId: null,
      academiaId: null,
      termsAcceptedAt: null,
      healthDataConsentAt: null,
      asaasCustomerId: null,
      asaasSubscriptionId: null,
      subscriptionStatus: null,
      subscriptionCancelAt: null,
      subscriptionCurrentPeriodEnd: null,
      isBackoffice: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (prismaService.users.findFirst as jest.Mock).mockResolvedValue(userData);

    const user = await userRepository.findByEmail('jonhdoe@jonhdoe.com');

    expect(user?.id).toEqual(userData.id);
  });

  it('looks up the email case-insensitively with LIKE wildcards escaped', async () => {
    (prismaService.users.findFirst as jest.Mock).mockResolvedValue(null);

    await userRepository.findByEmail('a_b%c@example.com');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prismaService.users.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: 'a\\_b\\%c@example.com', mode: 'insensitive' },
      },
      include: { product: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('should return user by ID', async () => {
    (prismaService.users.findUnique as jest.Mock).mockResolvedValue({
      id: 'userID',
    });

    const user = await userRepository.findUnique({
      id: 'userID',
    });

    expect(user?.id).toEqual('userID');
  });

  it('should return null when user is not found', async () => {
    (prismaService.users.findFirst as jest.Mock).mockResolvedValue(null);

    const user = await userRepository.findByEmail('notexists@jonhdoe.com');

    expect(user).toBeNull();
  });

  describe('activateUser', () => {
    it('should activate the user and return the updated user', async () => {
      const activatedUser = { ...userMock[0], active: true };
      (prismaService.users.update as jest.Mock).mockResolvedValue(
        activatedUser,
      );

      const result = await userRepository.activateUser(userMock[0].id);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.users.update).toHaveBeenCalledWith({
        where: { id: userMock[0].id },
        data: { active: true },
      });

      expect(result.id).toBe(userMock[0].id);
      expect(result.active).toBe(true);
    });
  });

  describe('updatePassword', () => {
    it('should update the user password and return the updated user', async () => {
      const newPasswordHash = 'new_hashed_password_456';

      const userWithNewPassword = { ...userMock[0], password: newPasswordHash };
      (prismaService.users.update as jest.Mock).mockResolvedValue(
        userWithNewPassword,
      );

      const result = await userRepository.updatePassword(
        userMock[0].id,
        newPasswordHash,
      );

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.users.update).toHaveBeenCalledWith({
        where: { id: userMock[0].id },
        data: { password: newPasswordHash },
      });

      expect(result.id).toBe(userMock[0].id);
      expect(result.password).toBe(newPasswordHash);
    });
  });

  it('should be instantiated correctly manually', () => {
    expect(new UserRepository(prismaService)).toBeDefined();
  });

  describe('User profile', () => {
    it('Update - no address', async () => {
      const userId = '1';
      const userData = {
        birthDate: new Date('2010-10-10'),
        name: 'Jonh Doe Doe',
        avatar: 'http://www.jonhdoe.com/jonhdoe.png',
        phone: '99999999999',
      };

      (prismaService.users.update as jest.Mock).mockResolvedValue({
        ...userMock[0],
        name: userData.name,
        avatar: userData.avatar,
        phone: userData.phone,
        password: undefined,
      });

      const newUser = await userRepository.updateUserProfile(
        userId,
        userData,
        undefined,
      );

      expect(newUser.phone).toEqual(userData.phone);
      expect(newUser.address).toBeNull();
    });

    it('Update - with address', async () => {
      const userId = '1';
      const userData = {
        birthDate: new Date('2010-10-10'),
        name: 'Jonh Doe Doe',
        avatar: 'http://www.jonhdoe.com/jonhdoe.png',
        phone: '99999999999',
      };
      const address = {
        addressLine1: 'Jonh Doe address line 1',
        addressLine2: 'Jonh Doe address line 2',
        district: 'Jonh Doe',
        city: 'JonhDoe City',
        region: 'Region Jonh Doe',
        postalCode: 'JonhDoeZip',
      };

      (prismaService.users.update as jest.Mock).mockResolvedValue({
        ...userMock[0],
        name: userData.name,
        avatar: userData.avatar,
        phone: userData.phone,
        password: undefined,
      });

      const newUser = await userRepository.updateUserProfile(
        userId,
        userData,
        address,
      );

      expect(newUser.phone).toEqual(userData.phone);
      expect(newUser.address).toBeDefined();
      expect(newUser.address?.district).toEqual(address.district);
    });

    it('Get profile', async () => {
      const newUser = await userRepository.getUserProfile(userMock[0].id);

      expect(newUser?.id).toEqual(userMock[0].id);
      expect(newUser?.name).toEqual(userMock[0].name);
    });
  });

  // UT-001, UT-002, UT-003 — the deletion transaction. Built with its own
  // Prisma double so the recorded call order is exactly this suite's.
  describe('deleteAccount', () => {
    let repository: UserRepository;
    let calls: string[];
    let tx: {
      measurementRecord: { deleteMany: jest.Mock };
      progressPhoto: { deleteMany: jest.Mock };
      notification: { deleteMany: jest.Mock };
      notificationPreference: { deleteMany: jest.Mock };
      professionalProfile: { deleteMany: jest.Mock };
      connectionRequest: { deleteMany: jest.Mock };
      usersToken: { deleteMany: jest.Mock };
      userAddress: { deleteMany: jest.Mock };
      oAuthIdentity: { deleteMany: jest.Mock };
      client: { deleteMany: jest.Mock; updateMany: jest.Mock };
      users: { delete: jest.Mock };
    };

    const record = (name: string) =>
      jest.fn().mockImplementation(() => {
        calls.push(name);
        return Promise.resolve({ count: 0 });
      });

    beforeEach(async () => {
      calls = [];
      tx = {
        measurementRecord: {
          deleteMany: record('measurementRecord.deleteMany'),
        },
        progressPhoto: { deleteMany: record('progressPhoto.deleteMany') },
        notification: { deleteMany: record('notification.deleteMany') },
        notificationPreference: {
          deleteMany: record('notificationPreference.deleteMany'),
        },
        professionalProfile: {
          deleteMany: record('professionalProfile.deleteMany'),
        },
        connectionRequest: {
          deleteMany: record('connectionRequest.deleteMany'),
        },
        usersToken: { deleteMany: record('usersToken.deleteMany') },
        userAddress: { deleteMany: record('userAddress.deleteMany') },
        oAuthIdentity: { deleteMany: record('oAuthIdentity.deleteMany') },
        client: {
          deleteMany: record('client.deleteMany'),
          updateMany: record('client.updateMany'),
        },
        users: { delete: record('users.delete') },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          UserRepository,
          {
            provide: PrismaService,
            useValue: {
              $transaction: jest
                .fn()
                .mockImplementation(
                  async (callback: (client: typeof tx) => Promise<unknown>) =>
                    await callback(tx),
                ),
            },
          },
        ],
      }).compile();

      repository = module.get<UserRepository>(UserRepository);
    });

    // UT-001
    it('deletes every owned table inside one transaction, user last', async () => {
      await repository.deleteAccount('u1');

      expect(tx.measurementRecord.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });
      expect(tx.progressPhoto.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });
      expect(tx.notification.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });
      expect(tx.notificationPreference.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });
      expect(tx.professionalProfile.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });
      expect(tx.connectionRequest.deleteMany).toHaveBeenCalledWith({
        where: { OR: [{ userId: 'u1' }, { professionalId: 'u1' }] },
      });
      expect(tx.usersToken.deleteMany).toHaveBeenCalledWith({
        where: { userID: 'u1' },
      });
      expect(tx.userAddress.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });
      expect(tx.oAuthIdentity.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });
      expect(tx.client.deleteMany).toHaveBeenCalledWith({
        where: { professionalId: 'u1' },
      });
      expect(tx.users.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });

      expect(calls).toEqual([
        'measurementRecord.deleteMany',
        'progressPhoto.deleteMany',
        'notification.deleteMany',
        'notificationPreference.deleteMany',
        'professionalProfile.deleteMany',
        'connectionRequest.deleteMany',
        'usersToken.deleteMany',
        'userAddress.deleteMany',
        'oAuthIdentity.deleteMany',
        'client.deleteMany',
        'client.updateMany',
        'users.delete',
      ]);
    });

    // UT-002
    it('propagates a failure from the final user delete', async () => {
      const failure = new Error('delete failed');
      tx.users.delete.mockRejectedValueOnce(failure);

      await expect(repository.deleteAccount('u1')).rejects.toThrow(failure);

      // Nothing past the failing statement ran, and the caller never sees a
      // resolved promise it could mistake for success.
      expect(calls).not.toContain('users.delete');
    });

    // UT-003
    it('clears the user link on remaining clients before deleting the user', async () => {
      await repository.deleteAccount('u1');

      expect(tx.client.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { userId: null },
      });
      expect(calls.indexOf('client.updateMany')).toBeLessThan(
        calls.indexOf('users.delete'),
      );
    });
  });

  // platform-metrics-dashboard task_01, UT-001..UT-007 — the 4 new
  // aggregate methods. Built with their own Prisma double exposing only
  // `count`/`findMany`, the two primitives these methods use.
  describe('Platform metrics aggregates', () => {
    let repository: UserRepository;
    let count: jest.Mock;
    let findMany: jest.Mock;

    beforeEach(async () => {
      count = jest.fn().mockResolvedValue(0);
      findMany = jest.fn().mockResolvedValue([]);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          UserRepository,
          { provide: PrismaService, useValue: { users: { count, findMany } } },
        ],
      }).compile();

      repository = module.get<UserRepository>(UserRepository);
    });

    function byRoleAndTier(
      counts: Partial<Record<ProductType, { free: number; premium: number }>>,
    ) {
      return ({
        where,
      }: {
        where: { product: { type: ProductType; tier: unknown } };
      }) => {
        const { type, tier } = where.product;
        const entry = counts[type] ?? { free: 0, premium: 0 };
        return Promise.resolve(
          tier === ProductTier.FREE ? entry.free : entry.premium,
        );
      };
    }

    // UT-001
    it('countRegisteredByRoleAndPlan returns the correct count for every role×plan cell', async () => {
      count.mockImplementation(
        byRoleAndTier({
          [ProductType.USER]: { free: 3, premium: 2 },
          [ProductType.NUTRITIONIST]: { free: 1, premium: 5 },
          [ProductType.PHYSICAL_EDUCATOR]: { free: 0, premium: 4 },
          [ProductType.ACADEMIA]: { free: 0, premium: 1 },
        }),
      );

      const result = await repository.countRegisteredByRoleAndPlan();

      expect(result).toEqual(
        expect.arrayContaining([
          { role: ProductType.USER, free: 3, premium: 2 },
          { role: ProductType.NUTRITIONIST, free: 1, premium: 5 },
          { role: ProductType.PHYSICAL_EDUCATOR, free: 0, premium: 4 },
          { role: ProductType.ACADEMIA, free: 0, premium: 1 },
        ]),
      );
    });

    // UT-002
    it('includes a role with zero users as 0, never omitted from the array', async () => {
      count.mockResolvedValue(0);

      const result = await repository.countRegisteredByRoleAndPlan();

      expect(result).toHaveLength(4);
      expect(result.map((entry) => entry.role).sort()).toEqual(
        Object.values(ProductType).sort(),
      );
      expect(
        result.every((entry) => entry.free === 0 && entry.premium === 0),
      ).toBe(true);
    });

    // UT-003
    it('countNewRegistrationsThisMonth counts only this month, grouped by role', async () => {
      count.mockImplementation(
        ({ where }: { where: { product: { type: ProductType } } }) =>
          Promise.resolve(where.product.type === ProductType.USER ? 7 : 0),
      );

      const result = await repository.countNewRegistrationsThisMonth();

      expect(result).toEqual(
        expect.arrayContaining([{ role: ProductType.USER, count: 7 }]),
      );
      expect(result).toHaveLength(4);
    });

    // UT-004 — a user at the last instant of the previous month must fail
    // this filter and one at the first instant of this month must pass it.
    // Proven directly against the exact boundaries the method sends to
    // Prisma: `gte` is inclusive of this month's first instant, `lt` is
    // exclusive of next month's first instant, so nothing from the
    // previous month can ever satisfy it.
    it('countNewRegistrationsThisMonth filters with an inclusive start and exclusive end of the current month', async () => {
      const now = new Date();
      const expectedGte = startOfMonth(now);
      const expectedLt = startOfNextMonth(now);
      const lastInstantOfPreviousMonth = new Date(expectedGte.getTime() - 1);

      await repository.countNewRegistrationsThisMonth();

      const [{ where }] = count.mock.calls[0] as [
        { where: { createdAt: { gte: Date; lt: Date } } },
      ];
      expect(where.createdAt.gte.getTime()).toBe(expectedGte.getTime());
      expect(where.createdAt.lt.getTime()).toBe(expectedLt.getTime());
      expect(lastInstantOfPreviousMonth.getTime()).toBeLessThan(
        where.createdAt.gte.getTime(),
      );
    });

    // UT-005
    it('countCanceledThisMonth counts only this month, grouped by role', async () => {
      count.mockImplementation(
        ({ where }: { where: { product: { type: ProductType } } }) =>
          Promise.resolve(
            where.product.type === ProductType.NUTRITIONIST ? 2 : 0,
          ),
      );

      const result = await repository.countCanceledThisMonth();

      expect(result).toEqual(
        expect.arrayContaining([{ role: ProductType.NUTRITIONIST, count: 2 }]),
      );
      expect(result).toHaveLength(4);
    });

    // UT-006 — a reactivation clears `subscriptionCancelAt` to null, and a
    // null value never satisfies a `gte`/`lt` range filter (proven at the
    // real-database level by IT-004); this only confirms the method filters
    // solely on that range, with no separate boolean this null-clearing
    // could bypass.
    it('countCanceledThisMonth filters only on the subscriptionCancelAt range', async () => {
      await repository.countCanceledThisMonth();

      const [{ where }] = count.mock.calls[0] as [
        { where: { subscriptionCancelAt: { gte: Date; lt: Date } } },
      ];
      expect(Object.keys(where.subscriptionCancelAt).sort()).toEqual([
        'gte',
        'lt',
      ]);
    });

    // UT-007
    it("sumActiveSubscriptionRevenue sums active subscribers' product price, and 0 with none", async () => {
      findMany.mockResolvedValueOnce([]);
      expect(await repository.sumActiveSubscriptionRevenue()).toBe(0);

      const manyActiveUsers = Array.from({ length: 500 }, (_, i) => ({
        product: { price: i % 2 === 0 ? 19.9 : 99.9 },
      }));
      findMany.mockResolvedValueOnce(manyActiveUsers);

      const total = await repository.sumActiveSubscriptionRevenue();

      const expected = manyActiveUsers.reduce(
        (sum, user) => sum + user.product.price,
        0,
      );
      expect(total).toBeCloseTo(expected, 5);

      const [{ where }] = findMany.mock.calls[1] as [
        { where: { subscriptionStatus: { in: string[] } } },
      ];
      expect(where.subscriptionStatus.in).toEqual(
        expect.arrayContaining(['active', 'trialing', 'past_due']),
      );
    });
  });
});
