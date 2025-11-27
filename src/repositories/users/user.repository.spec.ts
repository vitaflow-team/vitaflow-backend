import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, Users } from '@prisma/client';
import { UserRepository } from './user.repository';

const mockUser: Users = {
  id: 'id-test-user',
  email: 'test@example.com',
  password: 'oldpassword123',
  name: 'Test User',
  active: false,
  avatar: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

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

  it('should return null when user is not found', async () => {
    (prismaService.users.findUnique as jest.Mock).mockResolvedValue(null);

    const user = await userRepository.findByEmail({
      email: 'notexists@jonhdoe.com',
    });

    expect(user).toBeNull();
  });

  describe('activateUser', () => {
    it('should activate the user and return the updated user', async () => {
      const activatedUser = { ...mockUser, active: true };
      (prismaService.users.update as jest.Mock).mockResolvedValue(
        activatedUser,
      );

      const result = await userRepository.activateUser(mockUser.id);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.users.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { active: true },
      });

      expect(result.id).toBe(mockUser.id);
      expect(result.active).toBe(true);
    });
  });

  describe('updatePassword', () => {
    it('should update the user password and return the updated user', async () => {
      const newPasswordHash = 'new_hashed_password_456';

      const userWithNewPassword = { ...mockUser, password: newPasswordHash };
      (prismaService.users.update as jest.Mock).mockResolvedValue(
        userWithNewPassword,
      );

      const result = await userRepository.updatePassword(
        mockUser.id,
        newPasswordHash,
      );

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.users.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { password: newPasswordHash },
      });

      expect(result.id).toBe(mockUser.id);
      expect(result.password).toBe(newPasswordHash);
    });
  });

  it('should be instantiated correctly manually', () => {
    expect(new UserRepository(prismaService)).toBeDefined();
  });
});
