import { AcademiaModule } from '@/academia/academia.module';
import { AuthModule } from '@/auth/auth.module';
import { BillingModule } from '@/billing/billing.module';
import { PrismaService } from '@/database/prisma.service';
import { MailModule } from '@/mail/mail.module';
import { NotificationsModule } from '@/notifications/notifications.module';
import { AssessmentTemplatesRepository } from '@/repositories/clinical-records/assessmentTemplates.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { ProgressPhotosRepository } from '@/repositories/progress-photos/progressPhotos.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { Clock } from '@/scheduling/clock.service';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TemplatesService } from '@/clinical-records/templates/templates.service';
import {
  PLATFORM_ASAAS_API_KEY,
  PLATFORM_WEBHOOK_TOKEN,
} from './subscription/platformGateway.tokens';
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
import { SubscriptionWebhookController } from './subscription/subscriptionWebhook.controller';
import { SubscriptionWebhookService } from './subscription/subscriptionWebhook.service';
import { UserTokenService } from './token/userToken.service';

@Module({
  imports: [
    AuthModule,
    MailModule,
    NotificationsModule,
    AcademiaModule,
    BillingModule,
  ],
  controllers: [
    SignUpController,
    SignInController,
    RecoverpassController,
    ProfileController,
    SubscriptionController,
    SubscriptionWebhookController,
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
    AssessmentTemplatesRepository,
    TemplatesService,
    Clock,
    SignUpService,
    SignInService,
    RecoverpassService,
    ProfileService,
    SubscriptionService,
    SubscriptionWebhookService,
    {
      provide: PLATFORM_ASAAS_API_KEY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<string>('ASAAS_PLATFORM_API_KEY'),
    },
    {
      provide: PLATFORM_WEBHOOK_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<string>('ASAAS_PLATFORM_WEBHOOK_TOKEN'),
    },
  ],
})
export class UsersModule {}
