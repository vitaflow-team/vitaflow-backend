import { AuditLogger, type AuditEvent } from '@/auth/audit-logger.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { JwtService } from '@nestjs/jwt';
import { SignInDTO } from './signin.Dto';

const UnauthorizedUser = 'Usuário não autorizado.';
const AccountInactive = UnauthorizedUser + ' Conta inativa.';

import { Injectable } from '@nestjs/common';

@Injectable()
export class SignInService {
  constructor(
    private user: UserRepository,

    private hash: PasswordHash,

    private jwtService: JwtService,

    private uploadService: UploadService,

    private auditLogger: AuditLogger,
  ) {}

  async postSignIn({ email, password }: SignInDTO) {
    let failureReason = 'internal_error';
    let userId: string | undefined;

    try {
      const user = await this.user.findByEmail({ email });
      if (!user) {
        failureReason = 'invalid_credentials';
        throw new AppError(UnauthorizedUser, 401);
      }
      userId = user.id;

      if (!user.active) {
        failureReason = 'inactive_account';
        throw new AppError(AccountInactive, 401);
      }

      const validPassword = await this.hash.compareHash(
        password,
        user.password,
      );
      if (!validPassword) {
        failureReason = 'invalid_credentials';
        throw new AppError(UnauthorizedUser, 401);
      }

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

      const response = {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: signedAvatarUrl,
        productId: user.productId,
        productType: user.product?.type,
        productGroupId: user.product?.groupId,
        accessToken: await this.jwtService.signAsync(payload),
      };

      this.audit({
        event: 'signin_attempt',
        method: 'password',
        outcome: 'success',
        userId: user.id,
        timestamp: new Date().toISOString(),
      });

      return response;
    } catch (error) {
      this.auditFailure(failureReason, userId);
      throw error;
    }
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
