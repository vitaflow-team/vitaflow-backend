import { MailModule } from '@/mail/mail.module';
import { OAuthIdentityRepository } from '@/repositories/auth/oauthIdentity.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuditLogger } from './audit-logger.service';
import { DualBucketThrottlerGuard } from './dual-bucket-throttler.guard';
import { GoogleAuthService } from './google-auth.service';
import { PrismaService } from '@/database/prisma.service';

@Module({
  imports: [
    MailModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '12h' },
    }),
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
