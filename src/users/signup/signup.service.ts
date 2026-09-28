import { MailService } from '@/mail/mail.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { Injectable, Logger } from '@nestjs/common';
import { Product, TokenType, Users } from '@prisma/client';
import { UserTokenService } from '@/users/token/userToken.service';
import { AccountResponseDTO } from './accountResponse.Dto';
import { ActiveDTO } from './activate.Dto';
import { SignUpDTO } from './signup.Dto';

@Injectable()
export class SignUpService {
  private readonly logger = new Logger(SignUpService.name);

  constructor(
    private readonly user: UserRepository,
    private readonly products: ProductsRepository,
    private readonly client: ClientsRepository,
    private readonly hash: PasswordHash,
    private readonly userToken: UserTokenService,
    private readonly mailService: MailService,
  ) {}

  async postNewUser({
    email,
    name,
    password,
    checkPassword,
    termsAccepted,
    healthDataConsent,
  }: SignUpDTO): Promise<AccountResponseDTO> {
    await this.assertCanRegister(email, password, checkPassword);
    const freeProduct = await this.requireFreeProduct();

    const hasPassword = await this.hash.generateHash(password);

    const userCreated = await this.user.create({
      name,
      email,
      password: hasPassword,
      active: false,
      termsAcceptedAt: termsAccepted ? new Date() : null,
      healthDataConsentAt: healthDataConsent ? new Date() : null,
      product: { connect: { id: freeProduct.id } },
    });

    await this.sendActivationEmail(userCreated.id, name, email);

    return this.toAccountResponse(userCreated);
  }

  private async assertCanRegister(
    email: string,
    password: string,
    checkPassword: string,
  ): Promise<void> {
    if (checkPassword !== password) {
      throw new AppError(
        'A confirmação da senha não corresponde à senha.',
        400,
      );
    }

    const userExists = await this.user.findByEmail(email);
    if (userExists) {
      throw new AppError(
        'Este e-mail já está sendo usado por outro usuário.',
        400,
      );
    }
  }

  // Every account starts on Gratuito, so the plan is resolved before the
  // user row exists: a catalog without it would otherwise leave a
  // plan-less account, which is no longer a valid state.
  private async requireFreeProduct(): Promise<Product> {
    const freeProduct = await this.products.findFreeProduct();
    if (!freeProduct) {
      this.logger.error(
        'free_product_missing at=signup — no USER product priced at 0 without a Stripe price id',
      );
      throw new AppError(
        'Não foi possível criar a conta: plano Gratuito indisponível.',
        500,
      );
    }
    return freeProduct;
  }

  private async sendActivationEmail(
    userId: string,
    name: string,
    email: string,
  ): Promise<void> {
    const token = await this.userToken.issue(userId, TokenType.ACTIVATION);

    const activationLink = `${process.env.APP_URL}/signin/activate?token=${token}`;

    await this.mailService.sendEmailPassword(
      name,
      email,
      'Ative sua conta',
      './activation',
      activationLink,
    );
  }

  async activateNewUser({ token }: ActiveDTO): Promise<AccountResponseDTO> {
    const userToken = await this.userToken.findLive(
      token,
      TokenType.ACTIVATION,
    );
    const user = userToken
      ? await this.user.activateUserWithToken(userToken)
      : null;
    if (!user) {
      throw new AppError('Token inválido ou expirado.', 400);
    }

    // Existing client records are linked only now: before activation
    // nobody has proven they own this email address.
    await this.client.setAllClientUser(user.id, user.email);

    return this.toAccountResponse(user);
  }

  // Named fields only, so the password hash and any column added to `Users`
  // later never reach the response by default.
  private toAccountResponse(user: Users): AccountResponseDTO {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      active: user.active,
      phone: user.phone,
      birthDate: user.birthDate,
      productId: user.productId,
      termsAcceptedAt: user.termsAcceptedAt,
      healthDataConsentAt: user.healthDataConsentAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
