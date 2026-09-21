import { AppError } from '@/utils/app.erro';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClientsRepositoryMock } from 'mock/clients.repository.mock';
import { mailServiceMock } from 'mock/mail.service.mok';
import { passwordHashMock } from 'mock/password.hash.mock';
import { ProductsRepositoryMock } from 'mock/product.repository.mock';
import { userRepositoryMock } from 'mock/user.repository.mock';
import { userTokenRepositoryMock } from 'mock/userToken.repository.mock';
import { SignUpService } from './signup.service';

const users = userRepositoryMock.useValue;
const products = ProductsRepositoryMock.useValue;

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
});
