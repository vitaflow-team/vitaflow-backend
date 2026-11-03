import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { MailModule } from '@/mail/mail.module';
import { NotificationsModule } from '@/notifications/notifications.module';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { ProfessionalPremiumGuard } from '@/common/guards/professionalPremium.guard';
import { InvoiceNotifications } from './shared/invoiceNotifications.service';
import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { InvoicesRepository } from '@/repositories/billing/invoices.repository';
import { StudentTaxIdRepository } from '@/repositories/billing/studentTaxId.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingAccountController } from './account/billingAccount.controller';
import {
  API_PUBLIC_URL,
  BILLING_CIPHER_KEY,
  BillingAccountService,
} from './account/billingAccount.service';
import { AsaasGateway } from './gateway/asaas/asaasGateway';
import { PAYMENT_GATEWAY } from './gateway/paymentGateway';
import { InvoicesController } from './invoices/invoices.controller';
import { InvoicesService } from './invoices/invoices.service';
import { StudentInvoicesController } from './invoices/studentInvoices.controller';
import { ReconciliationService } from './reconciliation/reconciliation.service';
import { decodeCipherKey } from './shared/secretCipher';
import { AsaasWebhookController } from './webhook/asaasWebhook.controller';
import { AsaasWebhookService } from './webhook/asaasWebhook.service';

const ASAAS_PRODUCTION_URL = 'https://api.asaas.com/v3';

@Module({
  imports: [AuthModule, MailModule, NotificationsModule],
  controllers: [
    BillingAccountController,
    InvoicesController,
    StudentInvoicesController,
    AsaasWebhookController,
  ],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    BillingAccountRepository,
    InvoicesRepository,
    StudentTaxIdRepository,
    ProfessionalGuard,
    ProfessionalPremiumGuard,
    BillingAccountService,
    InvoicesService,
    AsaasWebhookService,
    ReconciliationService,
    InvoiceNotifications,
    Clock,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new AsaasGateway(
          config.get<string>('ASAAS_BASE_URL') ?? ASAAS_PRODUCTION_URL,
        ),
    },
    {
      provide: BILLING_CIPHER_KEY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        decodeCipherKey(config.getOrThrow<string>('BILLING_ENCRYPTION_KEY')),
    },
    {
      provide: API_PUBLIC_URL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<string>('API_PUBLIC_URL').replace(/\/$/, ''),
    },
  ],
  exports: [
    BillingAccountService,
    BillingAccountRepository,
    InvoicesService,
    InvoicesRepository,
    // Reused by UsersModule's platform subscription flow (ADR-010 decision
    // 2): the same AsaasGateway instance serves both, since every method
    // already takes the caller's own apiKey.
    PAYMENT_GATEWAY,
  ],
})
export class BillingModule {}
