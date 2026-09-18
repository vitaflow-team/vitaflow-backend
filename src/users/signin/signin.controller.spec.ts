import { AuditLogger } from '@/auth/audit-logger.service';
import { PrismaService } from '@/database/prisma.service';
import { AppError } from '@/utils/app.erro';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { jwtServiceMock } from 'mock/jwtService.mock';
import { passwordHashMock } from 'mock/password.hash.mock';
import { uploadServiceMock } from 'mock/upload.service.mock';
import { userMock, userRepositoryMock } from 'mock/user.repository.mock';
import { SignInController } from './signin.controller';
import { SignInDTO } from './signin.Dto';
import { SignInService } from './signin.service';

describe('SignInController Tests', () => {
  let signInController: SignInController;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }])],
      controllers: [SignInController],
      providers: [
        SignInService,
        jwtServiceMock,
        passwordHashMock,
        userRepositoryMock,
        uploadServiceMock,
        {
          provide: AuditLogger,
          useValue: { log: jest.fn(), warn: jest.fn() },
        },
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
    });

    expect(result.id).toEqual(userMock[0].id);
  });

  it('Login invalid user', async () => {
    await expect(
      signInController.postSignIn({
        email: 'invalidemail@jonhdoe.com',
        password: '12345',
      }),
    ).rejects.toThrow('Usuário não autorizado.');
  });

  it('Inactive user', async () => {
    await expect(
      signInController.postSignIn({
        email: 'jonhdoe1@jonhdoe.com',
        password: '12345',
      }),
    ).rejects.toThrow('Usuário não autorizado. Conta inativa.');
  });

  it('Invalid password', async () => {
    await expect(
      signInController.postSignIn({
        email: 'jonhdoe@jonhdoe.com',
        password: 'InvalidPassword',
      }),
    ).rejects.toThrow('Usuário não autorizado.');
  });

  it('rejects the legacy socialLogin bypass with an invalid password', async () => {
    const legacyBody = {
      email: 'jonhdoe@jonhdoe.com',
      password: 'InvalidPassword',
      socialLogin: true,
    } as SignInDTO;

    const error = await signInController
      .postSignIn(legacyBody)
      .catch((caught: AppError) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error.getStatus()).toBe(401);
  });
});
