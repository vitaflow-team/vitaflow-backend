import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { jwtServiceMock } from 'mock/jwtService.mock';
import { passwordHashMock } from 'mock/password.hash.mock';
import { uploadServiceMock } from 'mock/upload.service.mock';
import { userMock, userRepositoryMock } from 'mock/user.repository.mock';
import { SignInController } from './signin.controller';

describe('SignInController Tests', () => {
  let signInController: SignInController;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SignInController],
      providers: [
        jwtServiceMock,
        passwordHashMock,
        userRepositoryMock,
        uploadServiceMock,
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

    signInController = moduleFixture.get<SignInController>(SignInController);
  });

  it('Should be defined', () => {
    expect(signInController).toBeDefined();
  });

  it('Login valid user', async () => {
    const result = await signInController.postSignIn({
      email: 'jonhdoe@jonhdoe.com',
      password: '12345',
      socialLogin: false,
    });

    expect(result.id).toEqual(userMock[0].id);
  });

  it('Login invalid user', async () => {
    await expect(
      signInController.postSignIn({
        email: 'invalidemail@jonhdoe.com',
        password: '12345',
        socialLogin: false,
      }),
    ).rejects.toHaveProperty('statusCode', 401);
  });

  it('Inactive user', async () => {
    await expect(
      signInController.postSignIn({
        email: 'jonhdoe1@jonhdoe.com',
        password: '12345',
        socialLogin: false,
      }),
    ).rejects.toHaveProperty('statusCode', 401);
  });

  it('Invalid password', async () => {
    await expect(
      signInController.postSignIn({
        email: 'jonhdoe@jonhdoe.com',
        password: 'InvalidPassword',
        socialLogin: false,
      }),
    ).rejects.toHaveProperty('statusCode', 401);
  });

  it('Login Social with invalid password', async () => {
    const result = await signInController.postSignIn({
      email: 'jonhdoe@jonhdoe.com',
      password: 'InvalidPassword',
      socialLogin: true,
    });

    expect(result.id).toEqual(userMock[0].id);
  });
});
