import { MailModule } from '@/mail/mail.module';
import { OAuthIdentityRepository } from '@/repositories/auth/oauthIdentity.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuditLogger } from './auditLogger.service';
import { DualBucketThrottlerGuard } from './dualBucketThrottler.guard';
import { GoogleAuthService } from './googleAuth.service';
import { buildJwtOptions } from './jwtOptions';
import { PrismaService } from '@/database/prisma.service';

@Module({
  imports: [
    MailModule,
    JwtModule.register(buildJwtOptions(process.env.JWT_SECRET)),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 5,
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    PrismaService,
    UserRepository,
    OAuthIdentityRepository,
    ProductsRepository,
    UserTokenRepository,
    ClientsRepository,
    PasswordHash,
    UploadService,
    GoogleAuthService,
    AuditLogger,
    AuthService,
    AuthGuard,
    DualBucketThrottlerGuard,
  ],
  exports: [
    JwtModule,
    AuthGuard,
    GoogleAuthService,
    DualBucketThrottlerGuard,
    AuditLogger,
  ],
})
export class AuthModule {}
