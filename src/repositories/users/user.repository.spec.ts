import { PrismaService } from '@/database/prisma.service';
import { ProfileAddressDTO } from '@/users/profile/profileAddress.Dto';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, Users } from '@prisma/client';
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
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    } satisfies Users);
                  },
                ),
              findUnique: jest.fn(),
              update: jest.fn(),
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (prismaService.users.findUnique as jest.Mock).mockResolvedValue(userData);

    const user = await userRepository.findByEmail({
      email: 'jonhdoe@jonhdoe.com',
    });

    expect(user?.id).toEqual(userData.id);
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
    (prismaService.users.findUnique as jest.Mock).mockResolvedValue(null);

    const user = await userRepository.findByEmail({
      email: 'notexists@jonhdoe.com',
    });

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

  it('Update user profile - no address', async () => {
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

  it('Update user profile - with address', async () => {
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
});
