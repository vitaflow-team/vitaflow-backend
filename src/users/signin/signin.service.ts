import { AuditLogger } from '@/auth/auditLogger.service';
import { SignInResponseDTO } from '@/auth/signInResponse.Dto';
import { AuditEvent } from '@/auth/types/auditEvent';
import { UserWithProduct } from '@/auth/types/userWithProduct';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { JwtService } from '@nestjs/jwt';
import { SignInAttempt } from './signInAttempt';
import { SignInDTO } from './signin.Dto';

const UNAUTHORIZED_USER = 'Usuário não autorizado.';
const ACCOUNT_INACTIVE = UNAUTHORIZED_USER + ' Conta inativa.';

// A cost-12 hash of a random value nobody knows. Comparing against it when the
// email has no account makes that failure cost the same bcrypt work as a wrong
// password, so response timing does not reveal whether the account exists.
const DUMMY_PASSWORD_HASH =
  '$2b$12$Uvc2JnSfF30SGSfi2rATse5pMWwkqNltb49iHPxSO3W9uBI4I4o1W';

import { Injectable } from '@nestjs/common';

@Injectable()
export class SignInService {
  constructor(
    private readonly user: UserRepository,
    private readonly hash: PasswordHash,
    private readonly jwtService: JwtService,
    private readonly uploadService: UploadService,
    private readonly auditLogger: AuditLogger,
  ) {}

  async postSignIn({ email, password }: SignInDTO): Promise<SignInResponseDTO> {
    const attempt: SignInAttempt = { failureReason: 'internal_error' };

    try {
      const user = await this.authenticate(email, password, attempt);
      const response = await this.createSignInResponse(user);

      this.audit({
        event: 'signin_attempt',
        method: 'password',
        outcome: 'success',
        userId: user.id,
        timestamp: new Date().toISOString(),
      });

      return response;
    } catch (error) {
      this.auditFailure(attempt.failureReason, attempt.userId);
      throw error;
    }
  }

  // Records on `attempt` why and for whom it failed, so the caller's failure
  // audit line carries the same reason and user id as before the split.
  private async authenticate(
    email: string,
    password: string,
    attempt: SignInAttempt,
  ): Promise<UserWithProduct> {
    const user = await this.user.findByEmail(email);
    attempt.userId = user?.id;

    const validPassword = await this.hash.compareHash(
      password,
      user?.password ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !validPassword) {
      attempt.failureReason = 'invalid_credentials';
      throw new AppError(UNAUTHORIZED_USER, 401);
    }

    // Checked only after the password matched, so the inactive-account
    // message never tells a caller without the password that it exists.
    if (!user.active) {
      attempt.failureReason = 'inactive_account';
      throw new AppError(ACCOUNT_INACTIVE, 401);
    }

    return user;
  }

  private async createSignInResponse(
    user: UserWithProduct,
  ): Promise<SignInResponseDTO> {
    const signedAvatarUrl = user.avatar
      ? await this.uploadService.getSignedUrl(user.avatar)
      : null;

    const payload = {
      name: user.name,
      email: user.email,
      productId: user.productId,
      productType: user.product?.type,
      productGroupId: user.product?.groupId,
      avatar: signedAvatarUrl,
      id: user.id,
    };

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: signedAvatarUrl,
      productId: user.productId,
      productType: user.product?.type,
      productGroupId: user.product?.groupId,
      accessToken: await this.jwtService.signAsync(payload),
    };
  }

  private auditFailure(reason: string, userId?: string): void {
    this.audit(
      {
        event: 'signin_attempt',
        method: 'password',
        outcome: 'failure',
        reason,
        ...(userId ? { userId } : {}),
        timestamp: new Date().toISOString(),
      },
      true,
    );
  }

  private audit(event: AuditEvent, warning = false): void {
    try {
      if (warning) {
        this.auditLogger.warn(event);
      } else {
        this.auditLogger.log(event);
      }
    } catch {
      // Audit logging must never alter the authentication outcome.
    }
  }
}
