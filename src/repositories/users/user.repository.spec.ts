import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, Users } from '@prisma/client';
import { UserRepository } from './user.repository';

describe('UserRepository Tests', () => {
  let userRepository: UserRepository;

  const mockPrismaService = {
    users: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Prisma.UsersCreateInput }) => {
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
      findUnique: jest.fn(),
    } as unknown as PrismaService['users'],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRepository,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    userRepository = module.get<UserRepository>(UserRepository);
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

    (mockPrismaService.users.findUnique as jest.Mock).mockResolvedValue(
      userData,
    );

    const user = await userRepository.findByEmail({
      email: 'jonhdoe@jonhdoe.com',
    });

    expect(user?.id).toEqual(userData.id);
  });

  it('should return null when user is not found', async () => {
    (mockPrismaService.users.findUnique as jest.Mock).mockResolvedValue(null);

    const user = await userRepository.findByEmail({
      email: 'notexists@jonhdoe.com',
    });

    expect(user).toBeNull();
  });
});
