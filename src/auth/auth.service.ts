import { CodedError } from '@/common/errors/codedError';
import { MailService } from '@/mail/mail.service';
import { AcademiaStaffMemberRepository } from '@/repositories/academia/academiaStaffMember.repository';
import { OAuthIdentityRepository } from '@/repositories/auth/oauthIdentity.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Product, Users } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditLogger } from './auditLogger.service';
import { GoogleAuthService } from './googleAuth.service';
import { GoogleLinkIntentResponseDTO } from './googleLinkIntentResponse.Dto';
import {
  isGoogleLinkIntentFor,
  signGoogleLinkIntent,
} from './googleLinkIntent';
import { SignInResponseDTO } from './signInResponse.Dto';
import { GoogleLinkRequest } from './types/googleLinkRequest';
import { GoogleSignInOutcome } from './types/googleSignInOutcome';
import { GoogleVerifiedIdentity } from './types/googleVerifiedIdentity';
import { UserWithProduct } from './types/userWithProduct';

const GOOGLE_PROVIDER = 'google';
const GOOGLE_AUTH_FAILURE = 'Falha ao entrar com Google.';
const GOOGLE_LINK_REQUIRED_MESSAGE =
  'Esta conta tem acesso à equipe Vita Flow. Entre com e-mail e senha e ' +
  'conecte o Google em Configurações → Conta.';
const GOOGLE_RECEPTIONIST_MESSAGE =
  'Este e-mail é de um acesso de recepção. Entre com e-mail e senha.';
const GOOGLE_LINK_FAILURE = 'Não foi possível conectar o Google.';
const INVALID_PASSWORD = 'Senha incorreta.';
const GOOGLE_ALREADY_LINKED = 'Esta conta já está conectada ao Google.';
const GOOGLE_EMAIL_MISMATCH =
  'A conta Google escolhida tem um e-mail diferente do e-mail desta conta.';
const GOOGLE_IDENTITY_IN_USE =
  'Esta conta Google já está conectada a outra conta.';

type ResolvedSignIn = { user: UserWithProduct; outcome: GoogleSignInOutcome };

const sameEmail = (left: string, right: string): boolean =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly googleAuth: GoogleAuthService,
    private readonly identities: OAuthIdentityRepository,
    private readonly users: UserRepository,
    private readonly passwordHash: PasswordHash,
    private readonly jwtService: JwtService,
    private readonly uploadService: UploadService,
    private readonly mailService: MailService,
    private readonly auditLogger: AuditLogger,
    private readonly products: ProductsRepository,
    private readonly userTokens: UserTokenRepository,
    private readonly clients: ClientsRepository,
    private readonly receptionists: AcademiaStaffMemberRepository,
  ) {}

  async signInWithGoogle(idToken: string): Promise<SignInResponseDTO> {
    try {
      const verified = await this.googleAuth.verify(idToken);
      const resolved = await this.resolveIdentity(verified);
      const response = await this.createSignInResponse(resolved.user);

      this.safeAudit('log', {
        event: 'signin_attempt',
        method: 'google',
        outcome: 'success',
        reason: resolved.outcome,
        userId: resolved.user.id,
        timestamp: new Date().toISOString(),
      });

      return response;
    } catch (error) {
      this.safeAudit('warn', {
        event: 'signin_attempt',
        method: 'google',
        outcome: 'failure',
        reason: this.failureReason(error),
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  }

  // unified-login-account ADR-009: the signed-in owner asks to connect
  // Google. An account with staff access must prove its current password
  // here; an ordinary account, which Google would link on its own anyway,
  // is not asked for it.
  async issueGoogleLinkIntent(
    userId: string,
    password?: string,
  ): Promise<GoogleLinkIntentResponseDTO> {
    const account = await this.users.findUnique({ id: userId });
    if (!account) {
      throw new AppError(GOOGLE_LINK_FAILURE, 401, 'user_not_found');
    }
    if (await this.identities.findByUserId(userId, GOOGLE_PROVIDER)) {
      throw new CodedError(GOOGLE_ALREADY_LINKED, 409, 'google_already_linked');
    }
    if (account.isBackoffice) {
      await this.assertCurrentPassword(account, password);
    }

    return { intent: await signGoogleLinkIntent(this.jwtService, userId) };
  }

  // The target is always the authenticated account: the intent is checked
  // against it before Google is even consulted, and no identifier supplied
  // by the client is read.
  async linkGoogle(
    userId: string,
    { idToken, intent }: GoogleLinkRequest,
  ): Promise<SignInResponseDTO> {
    if (!(await isGoogleLinkIntentFor(this.jwtService, intent, userId))) {
      throw new CodedError(GOOGLE_LINK_FAILURE, 401, 'invalid_intent');
    }

    const verified = await this.googleAuth.verify(idToken);
    const account = await this.users.findByIdWithProduct(userId);
    if (!account) {
      throw new AppError(GOOGLE_LINK_FAILURE, 401, 'user_not_found');
    }
    if (!sameEmail(verified.email, account.email)) {
      throw new CodedError(GOOGLE_EMAIL_MISMATCH, 409, 'google_email_mismatch');
    }

    if (await this.attachGoogleIdentity(account, verified.sub)) {
      this.safeAudit('log', {
        event: 'account_linked',
        provider: GOOGLE_PROVIDER,
        source: 'settings',
        userId: account.id,
        timestamp: new Date().toISOString(),
      });
      await this.sendLinkNotification(account);
    }

    return await this.createSignInResponse(account);
  }

  private async assertCurrentPassword(
    account: Users,
    password?: string,
  ): Promise<void> {
    const matches =
      Boolean(password) &&
      (await this.passwordHash.compareHash(password!, account.password));
    if (!matches) {
      throw new CodedError(INVALID_PASSWORD, 401, 'invalid_password');
    }
  }

  // Returns false when this very identity was already linked to the account
  // (a repeated request), so the caller neither audits nor notifies twice.
  private async attachGoogleIdentity(
    account: Users,
    sub: string,
  ): Promise<boolean> {
    const owner = await this.identities.findByProviderAccount(
      GOOGLE_PROVIDER,
      sub,
    );
    if (owner) {
      if (owner.userId !== account.id) {
        throw new CodedError(
          GOOGLE_IDENTITY_IN_USE,
          409,
          'google_identity_in_use',
        );
      }
      return false;
    }
    if (await this.identities.findByUserId(account.id, GOOGLE_PROVIDER)) {
      throw new CodedError(GOOGLE_ALREADY_LINKED, 409, 'google_already_linked');
    }

    return await this.createIdentity(sub, account.id);
  }

  // unified-login-account ADR-008. Fixed order: the linked identity is the
  // key; the email only finds the account for a first link; an account with
  // staff access is never linked from here; a receptionist's email never
  // becomes an ordinary account; only then is an account created.
  private async resolveIdentity(
    verified: GoogleVerifiedIdentity,
  ): Promise<ResolvedSignIn> {
    const linked = await this.identities.findByProviderAccount(
      GOOGLE_PROVIDER,
      verified.sub,
    );
    if (linked) {
      return await this.signInLinked(linked.userId);
    }

    const account = await this.users.findByEmail(verified.email);
    if (account) {
      return await this.resolveExistingAccount(verified, account);
    }

    const receptionistEmail = verified.email.trim().toLowerCase();
    if (await this.receptionists.findByEmail(receptionistEmail)) {
      throw new CodedError(
        GOOGLE_RECEPTIONIST_MESSAGE,
        403,
        'google_receptionist_email',
      );
    }

    return await this.createGoogleUser(verified);
  }

  private async signInLinked(userId: string): Promise<ResolvedSignIn> {
    const user = await this.users.findByIdWithProduct(userId);
    if (!user) {
      throw new AppError(GOOGLE_AUTH_FAILURE, 401, 'linked_user_not_found');
    }
    return { user, outcome: 'signed_in' };
  }

  // Whoever controls the Google account for a staff member's email must not
  // gain staff access by that alone: the owner connects Google explicitly,
  // signed in and with the password (ADR-002). Nothing is linked, activated
  // or created — active or not, a staff account is left exactly as it was.
  private async resolveExistingAccount(
    verified: GoogleVerifiedIdentity,
    account: UserWithProduct,
  ): Promise<ResolvedSignIn> {
    if (account.isBackoffice) {
      throw new CodedError(
        GOOGLE_LINK_REQUIRED_MESSAGE,
        403,
        'google_link_required',
      );
    }
    return await this.resolveMatchedUser(verified, account);
  }

  private async resolveMatchedUser(
    verified: GoogleVerifiedIdentity,
    user: UserWithProduct,
  ): Promise<ResolvedSignIn> {
    const linkedIdentity = await this.identities.findByUserId(
      user.id,
      GOOGLE_PROVIDER,
    );

    if (linkedIdentity && linkedIdentity.providerAccountId !== verified.sub) {
      throw new AppError(GOOGLE_AUTH_FAILURE, 401, 'identity_conflict');
    }

    if (linkedIdentity) {
      return { user, outcome: 'signed_in' };
    }

    if (!user.active) {
      return await this.activateMatchedUser(verified, user);
    }

    const identityCreated = await this.createIdentity(verified.sub, user.id);
    if (!identityCreated) {
      return { user, outcome: 'signed_in' };
    }

    this.safeAudit('log', {
      event: 'account_linked',
      provider: GOOGLE_PROVIDER,
      userId: user.id,
      timestamp: new Date().toISOString(),
    });
    await this.sendLinkNotification(user);

    return { user, outcome: 'linked' };
  }

  private async activateMatchedUser(
    verified: GoogleVerifiedIdentity,
    user: UserWithProduct,
  ): Promise<ResolvedSignIn> {
    await this.revokeUnverifiedCredentials(user);
    await this.users.activateUser(user.id);
    await this.createIdentity(verified.sub, user.id);
    await this.clients.setAllClientUser(user.id, user.email);
    const activated = await this.users.findByIdWithProduct(user.id);
    if (!activated) {
      throw new AppError(GOOGLE_AUTH_FAILURE, 401, 'activated_user_not_found');
    }
    return { user: activated, outcome: 'activated' };
  }

  // Whoever registered this inactive account never proved they own the
  // email; Google just did. Their password and any pending activation or
  // reset token must stop working, or they keep a way into the account.
  private async revokeUnverifiedCredentials(user: Users): Promise<void> {
    await this.userTokens.deleteAll({ userID: user.id });

    if (!user.password) {
      return;
    }

    const unusable = await this.passwordHash.generateHash(randomUUID());
    await this.users.updatePassword(user.id, unusable);
    this.safeAudit('log', {
      event: 'password_invalidated',
      provider: GOOGLE_PROVIDER,
      userId: user.id,
      timestamp: new Date().toISOString(),
    });
  }

  private async createGoogleUser(
    verified: GoogleVerifiedIdentity,
  ): Promise<ResolvedSignIn> {
    const email = verified.email.trim().toLowerCase();
    const name = verified.name?.trim() || email.split('@')[0];
    const password = await this.passwordHash.generateHash(randomUUID());
    const freeProduct = await this.requireFreeProduct();

    let created: Users;
    try {
      created = await this.users.create({
        name,
        email,
        password,
        avatar: verified.picture,
        active: true,
        product: { connect: { id: freeProduct.id } },
      });
    } catch (error) {
      return await this.recoverFromUserConflict(error, verified, email);
    }

    const identityCreated = await this.createIdentity(verified.sub, created.id);
    if (!identityCreated) {
      return await this.signInIdentityRaceWinner(verified.sub);
    }

    await this.linkRegisteredStudents(created.id, email);

    const user = await this.users.findByIdWithProduct(created.id);
    return {
      user: user ?? { ...created, product: null },
      outcome: 'created',
    };
  }

  // A student an educator registered before this account existed is connected
  // now: Google has already verified the e-mail, which is the proof the
  // password signup waits for until activation. A failure here must never fail
  // the sign-in; the record is still linked by the next activation-type event.
  private async linkRegisteredStudents(
    userId: string,
    email: string,
  ): Promise<void> {
    try {
      await this.clients.setAllClientUser(userId, email);
    } catch {
      this.logger.warn(`google_link_failed userId=${userId}`);
    }
  }

  // Same rule as the password signup: Gratuito is resolved first so a
  // missing catalog entry fails the sign-in instead of producing a
  // plan-less Google account.
  private async requireFreeProduct(): Promise<Product> {
    const freeProduct = await this.products.findFreeProduct();
    if (!freeProduct) {
      this.logger.error(
        'free_product_missing at=google_signup — no USER product priced at 0 without a Stripe price id',
      );
      throw new AppError(GOOGLE_AUTH_FAILURE, 500, 'free_product_missing');
    }
    return freeProduct;
  }

  // A concurrent sign-in created the same email first (the unique index on
  // lower(email) refused this one): sign in as whoever now owns the Google
  // identity, or fall back to the account that holds the email.
  private async recoverFromUserConflict(
    error: unknown,
    verified: GoogleVerifiedIdentity,
    email: string,
  ): Promise<ResolvedSignIn> {
    if (!this.isUniqueConstraint(error)) {
      throw error;
    }

    const winningUser = await this.findProviderIdentityUser(verified.sub);
    if (winningUser) {
      return { user: winningUser, outcome: 'signed_in' };
    }

    const existing = await this.users.findByEmail(email);
    if (!existing) {
      throw error;
    }
    return await this.resolveExistingAccount(verified, existing);
  }

  private async findProviderIdentityUser(
    sub: string,
  ): Promise<UserWithProduct | null> {
    const winner = await this.waitForProviderIdentity(sub);
    if (!winner) {
      return null;
    }
    return await this.users.findByIdWithProduct(winner.userId);
  }

  private async signInIdentityRaceWinner(sub: string): Promise<ResolvedSignIn> {
    const winner = await this.identities.findByProviderAccount(
      GOOGLE_PROVIDER,
      sub,
    );
    if (!winner) {
      throw new AppError(GOOGLE_AUTH_FAILURE, 401, 'identity_race_unresolved');
    }
    return await this.signInLinked(winner.userId);
  }

  private async createIdentity(sub: string, userId: string): Promise<boolean> {
    try {
      await this.identities.create({
        provider: GOOGLE_PROVIDER,
        providerAccountId: sub,
        userId,
      });
      return true;
    } catch (error) {
      return await this.recoverFromIdentityConflict(error, sub, userId);
    }
  }

  // Returns false when the identity already links this very user, so the
  // caller treats the race as a plain sign-in rather than a new link.
  private async recoverFromIdentityConflict(
    error: unknown,
    sub: string,
    userId: string,
  ): Promise<boolean> {
    if (!this.isUniqueConstraint(error)) {
      throw error;
    }

    const byProvider = await this.waitForProviderIdentity(sub);
    if (byProvider && byProvider.userId !== userId) {
      throw new AppError(GOOGLE_AUTH_FAILURE, 401, 'identity_conflict');
    }
    if (byProvider) {
      return false;
    }

    const byUser = await this.identities.findByUserId(userId, GOOGLE_PROVIDER);
    if (byUser?.providerAccountId === sub) {
      return false;
    }

    throw new AppError(GOOGLE_AUTH_FAILURE, 401, 'identity_race_unresolved');
  }

  private async waitForProviderIdentity(sub: string) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const identity = await this.identities.findByProviderAccount(
        GOOGLE_PROVIDER,
        sub,
      );
      if (identity) {
        return identity;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    return null;
  }

  private async createSignInResponse(
    user: UserWithProduct,
  ): Promise<SignInResponseDTO> {
    const avatar = user.avatar
      ? await this.uploadService.getSignedUrl(user.avatar)
      : null;
    const payload = {
      name: user.name,
      email: user.email,
      productId: user.productId,
      productType: user.product?.type,
      productGroupId: user.product?.groupId,
      avatar,
      id: user.id,
    };

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar,
      productId: user.productId,
      productType: user.product?.type,
      productGroupId: user.product?.groupId,
      accessToken: await this.jwtService.signAsync(payload),
    };
  }

  // A notification failure never fails the request that linked the account.
  private async sendLinkNotification(user: Users): Promise<void> {
    try {
      await this.mailService.sendEmailPassword(
        user.name,
        user.email,
        'Sua conta foi vinculada ao Google',
        './google-linked',
        `${process.env.APP_URL ?? ''}/profile`,
      );
    } catch {
      this.safeAudit('warn', {
        event: 'link_notification_failed',
        provider: GOOGLE_PROVIDER,
        userId: user.id,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private safeAudit(
    level: 'log' | 'warn',
    event: Parameters<AuditLogger['log']>[0],
  ): void {
    try {
      this.auditLogger[level](event);
    } catch {
      // Audit delivery is deliberately non-blocking for authentication.
    }
  }

  // A coded refusal is logged by its code (google_link_required,
  // google_receptionist_email) — a category, never the email it concerns.
  private failureReason(error: unknown): string {
    if (error instanceof CodedError) {
      return error.code;
    }
    if (error instanceof AppError) {
      return error.reason ?? 'authentication_failed';
    }
    return 'internal_error';
  }

  private isUniqueConstraint(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
