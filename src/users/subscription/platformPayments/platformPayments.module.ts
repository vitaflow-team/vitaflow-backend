import { BillingModule } from '@/billing/billing.module';
import { PrismaService } from '@/database/prisma.service';
import { PlatformPaymentRepository } from '@/repositories/billing/platformPayment.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PLATFORM_ASAAS_API_KEY } from '../platformGateway.tokens';
import { PlatformPaymentEvents } from './platformPaymentEvents.service';
import { PlatformPaymentIngest } from './platformPaymentIngest.service';
import { PlatformPaymentSync } from './platformPaymentSync.service';

// The local copy of Vitaflow's own subscription payments (ADR-006): the
// webhook half, the nightly window sync and their shared ingest. It reuses
// BillingModule's gateway, since every gateway method takes the caller's key.
@Module({
  imports: [BillingModule],
  providers: [
    PrismaService,
    UserRepository,
    PlatformPaymentRepository,
    Clock,
    PlatformPaymentIngest,
    PlatformPaymentEvents,
    PlatformPaymentSync,
    {
      provide: PLATFORM_ASAAS_API_KEY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<string>('ASAAS_PLATFORM_API_KEY'),
    },
  ],
  exports: [PlatformPaymentEvents],
})
export class PlatformPaymentsModule {}
