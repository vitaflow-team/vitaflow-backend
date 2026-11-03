import {
  overdueInvoiceMessageForProfessional,
  overdueInvoiceMessageForStudent,
  paidInvoiceMessageForProfessional,
} from '@/billing/shared/invoiceMessages';
import { NotificationsService } from '@/notifications/notifications.service';
import { InvoicesRepository } from '@/repositories/billing/invoices.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { Injectable, Logger } from '@nestjs/common';
import { BillingAccount, Invoice } from '@prisma/client';

// Notify-once (ADR-003/ADR-007): a claim on paidNotifiedAt/overdueNotifiedAt
// shared by the webhook and the daily reconciliation job, so the same event
// reaching either path never notifies twice. A notification failure is
// logged and never fails the caller's own transition.
@Injectable()
export class InvoiceNotifications {
  private readonly logger = new Logger(InvoiceNotifications.name);

  constructor(
    private readonly invoices: InvoicesRepository,
    private readonly clients: ClientsRepository,
    private readonly notifications: NotificationsService,
  ) {}

  async notifyPaid(
    invoice: Invoice,
    account: BillingAccount,
    now: Date,
  ): Promise<void> {
    const claimed = await this.invoices.claimNotification(
      invoice.id,
      'paidNotifiedAt',
      now,
    );
    if (!claimed) return;
    const client = await this.clients.getClientById(invoice.clientId);
    if (!client) return;
    await this.notifySafely(
      account.userId,
      paidInvoiceMessageForProfessional(invoice, client.name),
      invoice.id,
    );
  }

  async notifyOverdue(
    invoice: Invoice,
    account: BillingAccount,
    now: Date,
  ): Promise<void> {
    const claimed = await this.invoices.claimNotification(
      invoice.id,
      'overdueNotifiedAt',
      now,
    );
    if (!claimed) return;
    const client = await this.clients.getClientById(invoice.clientId);
    if (!client) return;

    await this.notifySafely(
      account.userId,
      overdueInvoiceMessageForProfessional(invoice, client.name),
      invoice.id,
    );
    if (client.userId) {
      await this.notifySafely(
        client.userId,
        overdueInvoiceMessageForStudent(invoice, account.accountName),
        invoice.id,
      );
    }
  }

  private async notifySafely(
    userId: string,
    message: string,
    invoiceId: string,
  ): Promise<void> {
    try {
      await this.notifications.create(
        userId,
        'BILLING',
        message,
        undefined,
        true,
      );
    } catch {
      this.logger.error(`invoice_notification_failed invoiceId=${invoiceId}`);
    }
  }
}
