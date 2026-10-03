import { MailService } from '@/mail/mail.service';
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
import { SignInResponseDTO } from './signInResponse.Dto';
import { GoogleSignInOutcome } from './types/googleSignInOutcome';
import { GoogleVerifiedIdentity } from './types/googleVerifiedIdentity';
import { UserWithProduct } from './types/userWithProduct';

const GOOGLE_PROVIDER = 'google';
const GOOGLE_AUTH_FAILURE = 'Falha ao entrar com Google.';

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

  private async resolveIdentity(
    verified: GoogleVerifiedIdentity,
  ): Promise<{ user: UserWithProduct; outcome: GoogleSignInOutcome }> {
    const existingIdentity = await this.identities.findByProviderAccount(
      GOOGLE_PROVIDER,
      verified.sub,
    );

    if (existingIdentity) {
      const user = await this.users.findByIdWithProduct(
        existingIdentity.userId,
      );
      if (!user) {
        throw new AppError(GOOGLE_AUTH_FAILURE, 401, 'linked_user_not_found');
      }
      return { user, outcome: 'signed_in' };
    }

    const matchedUser = await this.users.findByEmailInsensitive(verified.email);
    if (matchedUser) {
      return await this.resolveMatchedUser(verified, matchedUser);
    }

    return await this.createGoogleUser(verified);
  }

  private async resolveMatchedUser(
    verified: GoogleVerifiedIdentity,
    user: UserWithProduct,
  ): Promise<{ user: UserWithProduct; outcome: GoogleSignInOutcome }> {
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
      await this.revokeUnverifiedCredentials(user);
      await this.users.activateUser(user.id);
      await this.createIdentity(verified.sub, user.id);
      await this.clients.setAllClientUser(user.id, user.email);
      const activated = await this.users.findByIdWithProduct(user.id);
      if (!activated) {
        throw new AppError(
          GOOGLE_AUTH_FAILURE,
          401,
          'activated_user_not_found',
        );
      }
      return { user: activated, outcome: 'activated' };
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
  ): Promise<{ user: UserWithProduct; outcome: GoogleSignInOutcome }> {
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

  // A concurrent sign-in created the same email first: sign in as whoever
  // now owns the Google identity, or fall back to the email-matched user.
  private async recoverFromUserConflict(
    error: unknown,
    verified: GoogleVerifiedIdentity,
    email: string,
  ): Promise<{ user: UserWithProduct; outcome: GoogleSignInOutcome }> {
    if (!this.isUniqueConstraint(error)) {
      throw error;
    }

    const winningUser = await this.findProviderIdentityUser(verified.sub);
    if (winningUser) {
      return { user: winningUser, outcome: 'signed_in' };
    }

    const existing = await this.users.findByEmailInsensitive(email);
    if (!existing) {
      throw error;
    }
    return await this.resolveMatchedUser(verified, existing);
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

  private async signInIdentityRaceWinner(
    sub: string,
  ): Promise<{ user: UserWithProduct; outcome: GoogleSignInOutcome }> {
    const winner = await this.identities.findByProviderAccount(
      GOOGLE_PROVIDER,
      sub,
    );
    if (!winner) {
      throw new AppError(GOOGLE_AUTH_FAILURE, 401, 'identity_race_unresolved');
    }
    const winningUser = await this.users.findByIdWithProduct(winner.userId);
    if (!winningUser) {
      throw new AppError(GOOGLE_AUTH_FAILURE, 401, 'linked_user_not_found');
    }
    return { user: winningUser, outcome: 'signed_in' };
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

  private failureReason(error: unknown): string {
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
