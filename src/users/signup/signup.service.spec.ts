import { AppError } from '@/utils/app.erro';
import { Logger } from '@nestjs/common';
import { TokenType, UsersToken } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { ClientsRepositoryMock } from 'mock/clients.repository.mock';
import { mailServiceMock } from 'mock/mail.service.mok';
import { passwordHashMock } from 'mock/password.hash.mock';
import { ProductsRepositoryMock } from 'mock/product.repository.mock';
import { userMock, userRepositoryMock } from 'mock/user.repository.mock';
import {
  userTokenMock,
  userTokenRaw,
  userTokenRepositoryMock,
} from 'mock/userToken.repository.mock';
import { hashToken, UserTokenService } from '../token/userToken.service';
import { SignUpService } from './signup.service';

const users = userRepositoryMock.useValue;
const products = ProductsRepositoryMock.useValue;
const clients = ClientsRepositoryMock.useValue;
const userTokens = userTokenRepositoryMock.useValue;
const mail = mailServiceMock.useValue;

const newUser = {
  email: 'free-plan-signup@jonhdoe.com',
  name: 'Jonh Doe',
  password: '12345',
  checkPassword: '12345',
  termsAccepted: true,
  healthDataConsent: true,
};

describe('SignUpService — free plan assignment', () => {
  let signUpService: SignUpService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        passwordHashMock,
        userRepositoryMock,
        mailServiceMock,
        userTokenRepositoryMock,
        UserTokenService,
        ClientsRepositoryMock,
        ProductsRepositoryMock,
        SignUpService,
      ],
    }).compile();

    signUpService = moduleFixture.get<SignUpService>(SignUpService);

    jest.clearAllMocks();
    products.findFreeProduct.mockResolvedValue({ id: 'free-1' });
  });

  // UT-003
  it('creates the user connected to the free product', async () => {
    await signUpService.postNewUser(newUser);

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: newUser.email,
        product: { connect: { id: 'free-1' } },
      }),
    );
  });

  // UT-004
  it('rejects, logs and creates nothing when the free product is missing', async () => {
    products.findFreeProduct.mockResolvedValue(null);
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(signUpService.postNewUser(newUser)).rejects.toBeInstanceOf(
      AppError,
    );

    expect(users.create).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  // critical-security-fixes UT-004
  it('returns no password key in the signup response', async () => {
    const result = await signUpService.postNewUser(newUser);

    expect(Object.keys(result)).not.toContain('password');
    expect(result).toMatchObject({
      id: 'idNewUser',
      email: newUser.email,
      active: false,
    });
  });

  it('returns no password key in the activation response', async () => {
    const result = await signUpService.activateNewUser({
      token: userTokenRaw.activation,
    });

    expect(Object.keys(result)).not.toContain('password');
  });

  // platform-hardening US-002 AC-1
  it('emails the raw activation token and stores only its hash', async () => {
    await signUpService.postNewUser(newUser);

    const [stored] = userTokens.replace.mock.calls[0] as [UsersToken];
    const [, , , , link] = mail.sendEmailPassword.mock.calls[0] as string[];
    const raw = /token=([^&]+)$/.exec(link)![1];

    expect(stored).toMatchObject({
      userID: 'idNewUser',
      type: TokenType.ACTIVATION,
    });
    expect(stored.tokenHash).toBe(hashToken(raw));
    expect(link).not.toContain(stored.tokenHash);
  });

  // critical-security-fixes UT-010
  it('never links client records at signup time', async () => {
    await signUpService.postNewUser(newUser);

    expect(clients.setAllClientUser).not.toHaveBeenCalled();
  });

  // critical-security-fixes UT-010
  it('links client records by email once the account is activated', async () => {
    const owner = userMock.find((user) => user.id === userTokenMock[1].userID)!;

    await signUpService.activateNewUser({ token: userTokenRaw.activation });

    expect(users.activateUserWithToken).toHaveBeenCalledWith(userTokenMock[1]);
    expect(clients.setAllClientUser).toHaveBeenCalledWith(
      owner.id,
      owner.email,
    );
  });

  it('links nothing when the activation token is unknown or expired', async () => {
    await expect(
      signUpService.activateNewUser({ token: 'unknown-token' }),
    ).rejects.toThrow('Token inválido ou expirado.');
    await expect(
      signUpService.activateNewUser({
        token: userTokenRaw.expiredActivation,
      }),
    ).rejects.toThrow('Token inválido ou expirado.');

    expect(clients.setAllClientUser).not.toHaveBeenCalled();
  });
});
