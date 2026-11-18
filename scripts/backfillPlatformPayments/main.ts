import { AsaasGateway } from '@/billing/gateway/asaas/asaasGateway';
import { PrismaService } from '@/database/prisma.service';
import { PlatformPaymentRepository } from '@/repositories/billing/platformPayment.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { PlatformPaymentIngest } from '@/users/subscription/platformPayments/platformPaymentIngest.service';
import { PlatformPaymentSync } from '@/users/subscription/platformPayments/platformPaymentSync.service';
import { Logger } from '@nestjs/common';

const ASAAS_PRODUCTION_URL = 'https://api.asaas.com/v3';

// One-time load of the platform account's whole payment history into the
// local PlatformPayment table (financial-health ADR-006). Run it by hand once
// after the payment events are enabled on the platform webhook: `yarn
// platform-payments:backfill`. It is idempotent (an upsert per Asaas payment
// id), so a failed run can simply be run again. Reads `.env` for
// DATABASE_URL, ASAAS_PLATFORM_API_KEY and, optionally, ASAAS_BASE_URL.
const logger = new Logger('PlatformPaymentsBackfill');

function loadEnvFile(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: the variables come from the environment itself.
  }
}

async function main(prisma: PrismaService): Promise<boolean> {
  const apiKey = process.env.ASAAS_PLATFORM_API_KEY;
  if (!apiKey) throw new Error('ASAAS_PLATFORM_API_KEY is not set.');

  const clock = new Clock();
  const sync = new PlatformPaymentSync(
    new AsaasGateway(process.env.ASAAS_BASE_URL || ASAAS_PRODUCTION_URL),
    apiKey,
    new PlatformPaymentIngest(
      new UserRepository(prisma),
      new PlatformPaymentRepository(prisma),
      clock,
    ),
    clock,
  );
  logger.log('Backfilling the platform payment history');
  const summary = await sync.backfill();
  logger.log(JSON.stringify(summary));
  return summary.ok;
}

loadEnvFile();
const prisma = new PrismaService();

main(prisma)
  .then(async (ok) => {
    await prisma.$disconnect();
    if (!ok) process.exit(1);
  })
  .catch(async (error: unknown) => {
    logger.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
