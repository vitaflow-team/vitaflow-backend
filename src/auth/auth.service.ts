import { MailService } from '@/mail/mail.service';
import { OAuthIdentityRepository } from '@/repositories/auth/oauthIdentity.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Product, ProductType, Users } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditLogger } from './audit-logger.service';
import {
  GoogleAuthService,
  GoogleVerifiedIdentity,
} from './google-auth.service';

const GOOGLE_PROVIDER = 'google';
const GOOGLE_AUTH_FAILURE = 'Falha ao entrar com Google.';

type UserWithProduct = Users & { product: Product | null };

export interface SignInResponse {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  productId: string | null;
  productType?: ProductType;
  productGroupId?: string;
  accessToken: string;
}

export type GoogleSignInOutcome =
  | 'created'
  | 'activated'
  | 'linked'
  | 'signed_in';

@Injectable()
export class AuthService {
  constructor(
    private readonly googleAuth: GoogleAuthService,
    private readonly identities: OAuthIdentityRepository,
    private readonly users: UserRepository,
    private readonly passwordHash: PasswordHash,
    private readonly jwtService: JwtService,
    private readonly uploadService: UploadService,
    private readonly mailService: MailService,
    private readonly auditLogger: AuditLogger,
  ) {}

  async signInWithGoogle(idToken: string): Promise<SignInResponse> {
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
      await this.users.activateUser(user.id);
      await this.createIdentity(verified.sub, user.id);
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

  private async createGoogleUser(
    verified: GoogleVerifiedIdentity,
  ): Promise<{ user: UserWithProduct; outcome: GoogleSignInOutcome }> {
    const email = verified.email.trim().toLowerCase();
    const name = verified.name?.trim() || email.split('@')[0];
    const password = await this.passwordHash.generateHash(randomUUID());

    let created: Users;
    try {
      created = await this.users.create({
        name,
        email,
        password,
        avatar: verified.picture,
        active: true,
      });
    } catch (error) {
      if (!this.isUniqueConstraint(error)) {
        throw error;
      }

      const winner = await this.waitForProviderIdentity(verified.sub);
      if (winner) {
        const user = await this.users.findByIdWithProduct(winner.userId);
        if (user) {
          return { user, outcome: 'signed_in' };
        }
      }

      const existing = await this.users.findByEmailInsensitive(email);
      if (!existing) {
        throw error;
      }
      return await this.resolveMatchedUser(verified, existing);
    }

    const identityCreated = await this.createIdentity(verified.sub, created.id);
    if (!identityCreated) {
      const winner = await this.identities.findByProviderAccount(
        GOOGLE_PROVIDER,
        verified.sub,
      );
      if (!winner) {
        throw new AppError(
          GOOGLE_AUTH_FAILURE,
          401,
          'identity_race_unresolved',
        );
      }
      const winningUser = await this.users.findByIdWithProduct(winner.userId);
      if (!winningUser) {
        throw new AppError(GOOGLE_AUTH_FAILURE, 401, 'linked_user_not_found');
      }
      return { user: winningUser, outcome: 'signed_in' };
    }

    const user = await this.users.findByIdWithProduct(created.id);
    return {
      user: user ?? { ...created, product: null },
      outcome: 'created',
    };
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
      if (!this.isUniqueConstraint(error)) {
        throw error;
      }

      const byProvider = await this.waitForProviderIdentity(sub);
      if (byProvider) {
        if (byProvider.userId !== userId) {
          throw new AppError(GOOGLE_AUTH_FAILURE, 401, 'identity_conflict');
        }
        return false;
      }

      const byUser = await this.identities.findByUserId(
        userId,
        GOOGLE_PROVIDER,
      );
      if (byUser?.providerAccountId === sub) {
        return false;
      }

      throw new AppError(GOOGLE_AUTH_FAILURE, 401, 'identity_race_unresolved');
    }
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
  ): Promise<SignInResponse> {
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
