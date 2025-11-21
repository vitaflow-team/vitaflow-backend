import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { jwtServiceMock } from 'mock/jwtService.mock';
import { passwordHashMock } from 'mock/password.hash.mock';
import { userMock, userRepositoryMock } from 'mock/user.repository.mock';
import { SinginController } from './singin.controller';

describe('SinginController Tests', () => {
  let singinController: SinginController;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SinginController],
      providers: [
        jwtServiceMock,
        passwordHashMock,
        userRepositoryMock,
        {
          provide: PrismaService,
          useValue: {
            onModuleInit: jest.fn().mockImplementation(() => {
              return Promise.resolve(true);
            }),
          },
        },
      ],
    }).compile();

    singinController = moduleFixture.get<SinginController>(SinginController);
  });

  it('Should be defined', () => {
    expect(singinController).toBeDefined();
  });

  it('Login valid user', async () => {
    const result = await singinController.postSingIn({
      email: 'jonhdoe@jonhdoe.com',
      password: '12345',
      socialLogin: false,
    });

    expect(result.id).toEqual(userMock[0].id);
  });

  it('Login invalid user', async () => {
    await expect(
      singinController.postSingIn({
        email: 'invalidemail@jonhdoe.com',
        password: '12345',
        socialLogin: false,
      }),
    ).rejects.toHaveProperty('statusCode', 401);
  });

  it('Inactive user', async () => {
    await expect(
      singinController.postSingIn({
        email: 'jonhdoe1@jonhdoe.com',
        password: '12345',
        socialLogin: false,
      }),
    ).rejects.toHaveProperty('statusCode', 401);
  });

  it('Invalid password', async () => {
    await expect(
      singinController.postSingIn({
        email: 'jonhdoe@jonhdoe.com',
        password: 'InvalidPassword',
        socialLogin: false,
      }),
    ).rejects.toHaveProperty('statusCode', 401);
  });

  it('Login Social with invalid password', async () => {
    const result = await singinController.postSingIn({
      email: 'jonhdoe@jonhdoe.com',
      password: 'InvalidPassword',
      socialLogin: true,
    });

    expect(result.id).toEqual(userMock[0].id);
  });
});
