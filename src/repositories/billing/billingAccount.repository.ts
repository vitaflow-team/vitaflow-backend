import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import {
  BillingAccount,
  BillingAccountStatus,
  BillingProvider,
  InvoiceStatus,
} from '@prisma/client';

export interface NewBillingAccount {
  accountName: string;
  apiKeyEncrypted: string;
  apiKeyFingerprint: string;
  webhookId: string;
  webhookTokenHash: string;
}

@Injectable()
export class BillingAccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveByUser(userId: string): Promise<BillingAccount | null> {
    return await this.prisma.billingAccount.findFirst({
      where: { userId, status: BillingAccountStatus.ACTIVE },
    });
  }

  // Looked up by id rather than by current owner: an invoice's account may
  // have been replaced since the invoice was created (ADR-009) — a replaced
  // account still holds its key for its own open invoices.
  async findById(id: string): Promise<BillingAccount | null> {
    return await this.prisma.billingAccount.findUnique({ where: { id } });
  }

  // A key held by another professional's account that is not disconnected yet.
  async findLiveHolderOfFingerprint(
    fingerprint: string,
    userId: string,
  ): Promise<BillingAccount | null> {
    return await this.prisma.billingAccount.findFirst({
      where: {
        apiKeyFingerprint: fingerprint,
        userId: { not: userId },
        status: {
          in: [BillingAccountStatus.ACTIVE, BillingAccountStatus.REPLACED],
        },
      },
    });
  }

  async countOpenInvoices(accountId: string): Promise<number> {
    return await this.prisma.invoice.count({
      where: {
        billingAccountId: accountId,
        status: { in: [InvoiceStatus.PENDING, InvoiceStatus.OVERDUE] },
      },
    });
  }

  // Marks the previous active account replaced (it keeps its key for its open
  // invoices) and creates the new one in the same transaction.
  async replaceActiveWith(
    userId: string,
    data: NewBillingAccount,
  ): Promise<BillingAccount> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.billingAccount.updateMany({
        where: { userId, status: BillingAccountStatus.ACTIVE },
        data: { status: BillingAccountStatus.REPLACED },
      });
      return await tx.billingAccount.create({
        data: {
          ...data,
          userId,
          provider: BillingProvider.ASAAS,
          status: BillingAccountStatus.ACTIVE,
        },
      });
    });
  }

  async disconnect(accountId: string): Promise<void> {
    await this.prisma.billingAccount.update({
      where: { id: accountId },
      data: {
        status: BillingAccountStatus.DISCONNECTED,
        apiKeyEncrypted: null,
        webhookId: null,
      },
    });
  }

  async markKeyInvalid(accountId: string, at: Date): Promise<void> {
    await this.prisma.billingAccount.update({
      where: { id: accountId },
      data: { keyInvalidAt: at },
    });
  }

  // Webhook authentication (ADR-007): any status that still holds a key —
  // a REPLACED account's own open invoices must keep receiving notices
  // until it is purged; only DISCONNECTED (apiKeyEncrypted null) is excluded.
  async findByWebhookTokenHash(hash: string): Promise<BillingAccount | null> {
    return await this.prisma.billingAccount.findFirst({
      where: { webhookTokenHash: hash, apiKeyEncrypted: { not: null } },
    });
  }

  // The daily job's own reconciliation scope: every account, of any status,
  // still holding a key — same rule as the webhook lookup above.
  async findAllWithKey(): Promise<BillingAccount[]> {
    return await this.prisma.billingAccount.findMany({
      where: { apiKeyEncrypted: { not: null } },
    });
  }

  // A replaced account is only safe to purge once none of its own invoices
  // are still open (ADR-009) — returns the ids actually cleared.
  async purgeReplacedWithoutOpenInvoices(): Promise<string[]> {
    const candidates = await this.prisma.billingAccount.findMany({
      where: {
        status: BillingAccountStatus.REPLACED,
        apiKeyEncrypted: { not: null },
      },
      select: { id: true },
    });
    const purged: string[] = [];
    for (const { id } of candidates) {
      const openCount = await this.countOpenInvoices(id);
      if (openCount > 0) continue;
      await this.prisma.billingAccount.update({
        where: { id },
        data: { apiKeyEncrypted: null, webhookId: null },
      });
      purged.push(id);
    }
    return purged;
  }
}
