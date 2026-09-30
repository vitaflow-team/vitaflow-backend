import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { MailModule } from '@/mail/mail.module';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { ProgressPhotosRepository } from '@/repositories/progress-photos/progressPhotos.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { PasswordHash } from '@/utils/password.hash';
import { StripeVerification } from '@/utils/stripeVerification';
import { UploadService } from '@/utils/upload.service';
import { Module } from '@nestjs/common';
import { ProfileController } from './profile/profile.controller';
import { ProfileService } from './profile/profile.service';
import { RecoverpassController } from './recoverpass/recoverpass.controller';
import { RecoverpassService } from './recoverpass/recoverpass.service';
import { SignInController } from './signin/signin.controller';
import { SignInService } from './signin/signin.service';
import { SignUpController } from './signup/signup.controller';
import { SignUpService } from './signup/signup.service';
import { SubscriptionController } from './subscription/subscription.controller';
import { SubscriptionService } from './subscription/subscription.service';
import { SubscriptionSyncController } from './subscription/subscriptionSync.controller';
import { UserTokenService } from './token/userToken.service';

@Module({
  imports: [AuthModule, MailModule],
  controllers: [
    SignUpController,
    SignInController,
    RecoverpassController,
    ProfileController,
    SubscriptionController,
    SubscriptionSyncController,
  ],
  providers: [
    PasswordHash,
    PrismaService,
    UserRepository,
    UserTokenRepository,
    UserTokenService,
    UploadService,
    ClientsRepository,
    ProductsRepository,
    ProgressPhotosRepository,
    StripeVerification,
    SignUpService,
    SignInService,
    RecoverpassService,
    ProfileService,
    SubscriptionService,
  ],
})
export class UsersModule {}
