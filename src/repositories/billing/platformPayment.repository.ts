import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { PlatformPaymentStatus, Prisma } from '@prisma/client';
import type { PlatformPaymentData } from './types/platformPaymentData';
import type { UpsertCounts } from './types/upsertCounts';

function valuesOf(row: PlatformPaymentData): Prisma.Sql {
  return Prisma.sql`(
    gen_random_uuid()::text, ${row.asaasPaymentId}, ${row.userId},
    ${row.asaasCustomerId}, ${row.asaasSubscriptionId}::text,
    ${row.productType}::"ProductType", ${row.productName}, ${row.valueCents}::integer,
    ${row.status}::"PlatformPaymentStatus", ${row.dueDate}::date,
    ${row.paidAt}::date, ${row.paidAmountCents}::integer, now()
  )`;
}

// The local copy of Vitaflow's own subscription payments (financial-health
// ADR-006): written by the platform webhook, the nightly window sync and the
// backfill, all through the same idempotent upsert keyed by the Asaas id.
@Injectable()
export class PlatformPaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  // One statement per batch. A repeated notice rewrites the same values, so
  // `updatedAt` always marks the last time the gateway confirmed the row. The
  // product snapshot is taken when the row is created and never rewritten, and
  // a payment date the gateway stopped reporting is kept.
  async upsertMany(rows: PlatformPaymentData[]): Promise<UpsertCounts> {
    if (rows.length === 0) return { created: 0, updated: 0 };
    const result = await this.prisma.$queryRaw<
      { created: boolean }[]
    >(Prisma.sql`
      INSERT INTO "PlatformPayment" (
        "id", "asaasPaymentId", "userId", "asaasCustomerId", "asaasSubscriptionId",
        "productType", "productName", "valueCents", "status", "dueDate", "paidAt",
        "paidAmountCents", "updatedAt"
      )
      VALUES ${Prisma.join(rows.map(valuesOf))}
      ON CONFLICT ("asaasPaymentId") DO UPDATE SET
        "userId" = EXCLUDED."userId",
        "asaasCustomerId" = EXCLUDED."asaasCustomerId",
        "asaasSubscriptionId" = EXCLUDED."asaasSubscriptionId",
        "valueCents" = EXCLUDED."valueCents",
        "status" = EXCLUDED."status",
        "dueDate" = EXCLUDED."dueDate",
        "paidAt" = CASE WHEN EXCLUDED."status" = 'PAID'
          THEN COALESCE(EXCLUDED."paidAt", "PlatformPayment"."paidAt")
          ELSE EXCLUDED."paidAt" END,
        "paidAmountCents" = EXCLUDED."paidAmountCents",
        "updatedAt" = now()
      RETURNING ("xmax" = 0) AS "created"
    `);
    const created = result.filter((row) => row.created).length;
    return { created, updated: result.length - created };
  }

  // A payment removed at the gateway only changes a row we already hold: a
  // payment never recorded is not worth a row.
  async cancelMany(asaasPaymentIds: string[]): Promise<number> {
    if (asaasPaymentIds.length === 0) return 0;
    const result = await this.prisma.platformPayment.updateMany({
      where: {
        asaasPaymentId: { in: asaasPaymentIds },
        status: { not: PlatformPaymentStatus.CANCELED },
      },
      data: { status: PlatformPaymentStatus.CANCELED },
    });
    return result.count;
  }
}
