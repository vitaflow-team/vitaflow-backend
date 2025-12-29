import { Test, TestingModule } from '@nestjs/testing';
import { mailServiceMock } from 'mock/mail.service.mok';
import { passwordHashMock } from 'mock/password.hash.mock';
import { userRepositoryMock } from 'mock/user.repository.mock';
import { userTokenServiceMock } from 'mock/userToken.repository.mock';
import { RecoverpassController } from './recoverpass.controller';

describe('RecoverPassController Tests', () => {
  let recoverPassController: RecoverpassController;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [RecoverpassController],
      providers: [
        userRepositoryMock,
        userTokenServiceMock,
        mailServiceMock,
        passwordHashMock,
        mailServiceMock,
      ],
    }).compile();

    recoverPassController = moduleFixture.get<RecoverpassController>(
      RecoverpassController,
    );
  });

  it('Should be defined', () => {
    expect(recoverPassController).toBeDefined();
  });

  describe('RecoverpassController.postRecoverpass - Tests', () => {
    it('Recover password - Not existing email', async () => {
      const recover = { email: 'naoencontrou@jonhdoe.com' };

      const result = await recoverPassController.postRecoverpass(recover);

      expect(result).toEqual(false);
    });

    it('Recover password - create token', async () => {
      const recover = { email: 'jonhdoe@jonhdoe.com' };

      const result = await recoverPassController.postRecoverpass(recover);

      expect(result).toEqual(true);
    });
  });

  describe('RecoverpassController.postVerifyToken - Tests', () => {
    it('Recover password - Token not exists', async () => {
      const tokenData = {
        token: 'invalidTokenID',
        password: 'newStrongPassword123',
        checkPassword: 'newStrongPassword123',
      };

      await expect(
        recoverPassController.postChangePassword(tokenData),
      ).rejects.toThrow('Token inválido ou expirado.');
    });

    it('Recover password - Token expired', async () => {
      const tokenData = {
        token: 'userTokenMockID1',
        password: 'newStrongPassword123',
        checkPassword: 'newStrongPassword123',
      };

      await expect(
        recoverPassController.postChangePassword(tokenData),
      ).rejects.toThrow('Token inválido ou expirado.');
    });

    it('Recover password - password different the checkPassword', async () => {
      const tokenData = {
        token: 'userTokenMockID2',
        password: 'newStrongPassword123',
        checkPassword: 'differentPassword123',
      };

      await expect(
        recoverPassController.postChangePassword(tokenData),
      ).rejects.toThrow('A confirmação da senha não corresponde à senha.');
    });

    it('Recover password - change password', async () => {
      const tokenData = {
        token: 'userTokenMockID2',
        password: 'newStrongPassword123',
        checkPassword: 'newStrongPassword123',
      };

      const result = await recoverPassController.postChangePassword(tokenData);

      expect(result).toEqual(true);
    });
  });
});
