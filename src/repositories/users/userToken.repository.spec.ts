import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { UserTokenRepository } from './userToken.repository';

describe('UserRepository Tests', () => {
  let userTokenRepository: UserTokenRepository;
  let prismaService: PrismaService;

  const userMock = {
    id: '1',
    name: 'Jonh Doe',
    email: 'jonhdoe@jonhdoe.com',
    password: '12345',
    avatar: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrismaService = {
    usersToken: {
      create: jest.fn().mockImplementation(({ data: { user } }) => {
        return Promise.resolve({
          id: 'userTokenID',
          userID: user.connect.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }),
      deleteMany: jest.fn(),
      findUnique: jest.fn().mockImplementation(({ where: { id } }) => {
        return Promise.resolve(id === 'userTokenID');
      }),
    },
  };

  beforeEach(async () => {
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
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('Should create a user token', async () => {
    const userToken = await userTokenRepository.create({
      user: { connect: userMock },
    });

    expect(userToken.id).not.toBeNull();
    expect(userToken.userID).toEqual(userMock.id);
  });

  it('Should delete all tokens matching the criteria', async () => {
    const spy = jest.spyOn(prismaService.usersToken, 'deleteMany');

    await userTokenRepository.deleteAll({ id: 'userID' });

    expect(spy).toHaveBeenCalledWith({
      where: { id: 'userID' },
    });
  });

  it('Should return a user token by ID', async () => {
    const result = await userTokenRepository.findById({ id: 'userTokenID' });

    expect(result).toEqual(true);
  });
});
