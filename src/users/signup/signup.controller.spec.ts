import { Test, TestingModule } from '@nestjs/testing';
import { ClientsRepositoryMock } from 'mock/clients.repository.mock';
import { jwtServiceMock } from 'mock/jwtService.mock';
import { mailServiceMock } from 'mock/mail.service.mok';
import { passwordHashMock } from 'mock/password.hash.mock';
import { userRepositoryMock } from 'mock/user.repository.mock';
import { userTokenServiceMock } from 'mock/userToken.repository.mock';
import { SignUpController } from './signup.controller';

describe('SignUpController Tests', () => {
  let signUpController: SignUpController;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SignUpController],
      providers: [
        passwordHashMock,
        userRepositoryMock,
        jwtServiceMock,
        mailServiceMock,
        userTokenServiceMock,
        ClientsRepositoryMock,
      ],
    }).compile();

    signUpController = moduleFixture.get<SignUpController>(SignUpController);
  });

  it('Should be defined', () => {
    expect(signUpController).toBeDefined();
  });

  describe('SignupController.postNewUser - Tests', () => {
    it('Creating new user - Existing email', async () => {
      const newUser = {
        email: 'jonhdoe@jonhdoe.com',
        name: 'Jonh Doe',
        password: '12345',
        checkPassword: '12345',
      };

      await expect(
        signUpController.postNewUser(newUser),
      ).rejects.toHaveProperty('statusCode', 400);
    });

    it('Creating new user - Confirm incorrect password', async () => {
      const newUser = {
        email: 'jonhdoeNewUser@jonhdoe.com',
        name: 'Jonh Doe',
        password: '12345',
        checkPassword: '54321',
      };

      await expect(
        signUpController.postNewUser(newUser),
      ).rejects.toHaveProperty('statusCode', 400);
    });

    it('Creating new user - Success', async () => {
      const newUser = {
        email: 'jonhdoeNewUser@jonhdoe.com',
        name: 'Jonh Doe',
        password: '12345',
        checkPassword: '12345',
      };

      const result = await signUpController.postNewUser(newUser);

      expect(result.id).toEqual('idNewUser');
      expect(result.email).toEqual(newUser.email);
      expect(result.active).toEqual(false);
      expect(result.password).toBeUndefined();
    });

    it('Active New User - Error', async () => {
      const token = {
        token: 'tokenNotFound',
      };

      const result = await signUpController.activateNewUser(token);

      expect(result).toBeNull();
    });

    it('Active New User - Token expired', async () => {
      const token = {
        token: 'userTokenMockID1',
      };

      await expect(
        signUpController.activateNewUser(token),
      ).rejects.toHaveProperty('statusCode', 400);
    });

    it('Active New User - Success', async () => {
      const token = {
        token: 'userTokenMockID2',
      };

      const result = await signUpController.activateNewUser(token);

      expect(result?.active).toEqual(true);
    });
  });
});
