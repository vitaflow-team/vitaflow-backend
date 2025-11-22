import { Test, TestingModule } from '@nestjs/testing';
import { passwordHashMock } from 'mock/password.hash.mock';
import { userRepositoryMock } from 'mock/user.repository.mock';
import { SingupController } from '../singup/singup.controller';

describe('SingupController Tests', () => {
  let singupController: SingupController;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SingupController],
      providers: [passwordHashMock, userRepositoryMock],
    }).compile();

    singupController = moduleFixture.get<SingupController>(SingupController);
  });

  it('Should be defined', () => {
    expect(singupController).toBeDefined();
  });

  describe('SingupController.postNewUser - Tests', () => {
    it('Creating new user - Existing email', async () => {
      const newUser = {
        email: 'jonhdoe@jonhdoe.com',
        name: 'Jonh Doe',
        password: '12345',
        checkPassword: '12345',
      };

      await expect(
        singupController.postNewUser(newUser),
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
        singupController.postNewUser(newUser),
      ).rejects.toHaveProperty('statusCode', 400);
    });

    it('Creating new user - Success', async () => {
      const newUser = {
        email: 'jonhdoeNewUser@jonhdoe.com',
        name: 'Jonh Doe',
        password: '12345',
        checkPassword: '12345',
      };

      const result = await singupController.postNewUser(newUser);

      expect(result.id).toEqual('idNewUser');
      expect(result.email).toEqual(newUser.email);
      expect(result.active).toEqual(false);
      expect(result.password).toBeUndefined();
    });
  });
});
