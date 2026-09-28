import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { mailServiceMock } from 'mock/mail.service.mok';
import { passwordHashMock } from 'mock/password.hash.mock';
import { userRepositoryMock } from 'mock/user.repository.mock';
import {
  userTokenRaw,
  userTokenRepositoryMock,
} from 'mock/userToken.repository.mock';
import { UserTokenService } from '../token/userToken.service';
import { RecoverpassController } from './recoverpass.controller';
import { RecoverpassService } from './recoverpass.service';

describe('RecoverPassController Tests', () => {
  let recoverPassController: RecoverpassController;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }])],
      controllers: [RecoverpassController],
      providers: [
        userRepositoryMock,
        userTokenRepositoryMock,
        UserTokenService,
        mailServiceMock,
        passwordHashMock,
        RecoverpassService,
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
    it('Recover password - Not existing email answers like an existing one', async () => {
      const recover = { email: 'naoencontrou@jonhdoe.com' };

      const result = await recoverPassController.postRecoverpass(recover);

      expect(result).toEqual(true);
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
        token: userTokenRaw.expiredRecovery,
        password: 'newStrongPassword123',
        checkPassword: 'newStrongPassword123',
      };

      await expect(
        recoverPassController.postChangePassword(tokenData),
      ).rejects.toThrow('Token inválido ou expirado.');
    });

    it('Recover password - Activation token is rejected', async () => {
      const tokenData = {
        token: userTokenRaw.activation,
        password: 'newStrongPassword123',
        checkPassword: 'newStrongPassword123',
      };

      await expect(
        recoverPassController.postChangePassword(tokenData),
      ).rejects.toThrow('Token inválido ou expirado.');
    });

    it('Recover password - password different the checkPassword', async () => {
      const tokenData = {
        token: userTokenRaw.recovery,
        password: 'newStrongPassword123',
        checkPassword: 'differentPassword123',
      };

      await expect(
        recoverPassController.postChangePassword(tokenData),
      ).rejects.toThrow('A confirmação da senha não corresponde à senha.');
    });

    it('Recover password - change password', async () => {
      const tokenData = {
        token: userTokenRaw.recovery,
        password: 'newStrongPassword123',
        checkPassword: 'newStrongPassword123',
      };

      const result = await recoverPassController.postChangePassword(tokenData);

      expect(result).toEqual(true);
    });
  });
});
