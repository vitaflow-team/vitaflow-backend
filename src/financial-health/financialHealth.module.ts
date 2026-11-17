import { AuthModule } from '@/auth/auth.module';
import { BillingModule } from '@/billing/billing.module';
import { PrismaService } from '@/database/prisma.service';
import { FinancialHealthRepository } from '@/repositories/billing/financialHealth.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { Module } from '@nestjs/common';
import { FinancialHealthController } from './financialHealth.controller';
import { FinancialHealthService } from './financialHealth.service';

// The professional and gym money panels (ADR-009). Read-only: it owns no
// writes and reuses BillingModule for the billing-owner rules and the
// account repository.
@Module({
  imports: [AuthModule, BillingModule],
  controllers: [FinancialHealthController],
  providers: [
    PrismaService,
    UserRepository,
    FinancialHealthRepository,
    FinancialHealthService,
    Clock,
  ],
})
export class FinancialHealthModule {}
