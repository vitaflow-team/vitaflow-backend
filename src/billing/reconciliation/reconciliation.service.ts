import { BillingAccountService } from '@/billing/account/billingAccount.service';
import { PAYMENT_GATEWAY } from '@/billing/gateway/paymentGateway';
import type { PaymentGateway } from '@/billing/gateway/paymentGateway';
import { BILLING_LIMITS } from '@/billing/shared/billingLimits';
import { brasiliaDateKey } from '@/billing/shared/dates';
import {
  applyChargeToInvoice,
  invoiceTransitionToUpdateData,
} from '@/billing/shared/invoiceTransitions';
import { InvoiceNotifications } from '@/billing/shared/invoiceNotifications.service';
import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { InvoicesRepository } from '@/repositories/billing/invoices.repository';
import { Clock } from '@/scheduling/clock.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BillingAccount, Invoice, InvoiceStatus } from '@prisma/client';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The daily safety net behind the webhook (ADR-007 decision 6): the local
// overdue rule, reconciling every account that still holds a key against
// its own open invoices, purging keys of replaced accounts with nothing
// left open, and clearing crash-window reservations (ADR-009). Time comes
// only from `Clock` (UT-094), never `new Date()` directly in this file.
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly invoices: InvoicesRepository,
    private readonly accounts: BillingAccountRepository,
    private readonly accountService: BillingAccountService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly notify: InvoiceNotifications,
    private readonly clock: Clock,
  ) {}

  @Cron('30 3 * * *', { timeZone: 'America/Sao_Paulo' })
  async run(): Promise<void> {
    const now = this.clock.now();
    const todayKey = brasiliaDateKey(now);

    const overdue = await this.localOverdueTransition(todayKey, now);
    const reconciled = await this.reconcileOpenInvoices(now);
    const purgedIds = await this.accounts.purgeReplacedWithoutOpenInvoices();
    for (const id of purgedIds) {
      this.logger.log(`billing_account_purged accountId=${id}`);
    }

    const graceMs = BILLING_LIMITS.orphanReservationGraceMinutes * 60_000;
    const removed = await this.invoices.deleteStaleReservations(
      new Date(now.getTime() - graceMs),
    );
    if (removed > 0) {
      this.logger.log(`orphan_reservation_removed count=${removed}`);
    }

    const checked = overdue.checked + reconciled.checked;
    const changed = overdue.changed + reconciled.changed;
    this.logger.log(
      `reconciliation_run checked=${checked} changed=${changed} failed=${reconciled.failed}`,
    );
  }

  // Pending invoices whose due date has already passed become overdue,
  // each claimed and notified once; a paid invoice is never in this set
  // (findDueForOverdueTransition only selects PENDING rows).
  private async localOverdueTransition(
    todayKey: string,
    now: Date,
  ): Promise<{ checked: number; changed: number }> {
    const due = await this.invoices.findDueForOverdueTransition(todayKey);
    let changed = 0;
    for (const invoice of due) {
      const updated = await this.invoices.transition(
        invoice.id,
        [InvoiceStatus.PENDING],
        { status: InvoiceStatus.OVERDUE },
      );
      if (!updated) continue;
      changed += 1;
      this.logger.log(
        `invoice_transition from=${invoice.status} to=OVERDUE source=reconciliation`,
      );
      // notifyOverdue needs the invoice's account, not just its id.
      const account = await this.accounts.findById(updated.billingAccountId);
      if (account) await this.notify.notifyOverdue(updated, account, now);
    }
    return { checked: due.length, changed };
  }

  // Reads every open invoice of every account that still holds a key
  // (spacing the gateway calls) and applies the same read-and-update the
  // webhook uses — covering notices the webhook never received.
  private async reconcileOpenInvoices(
    now: Date,
  ): Promise<{ checked: number; changed: number; failed: number }> {
    const accounts = await this.accounts.findAllWithKey();
    let checked = 0;
    let changed = 0;
    let failed = 0;

    for (const account of accounts) {
      const open = await this.invoices.findOpenByAccount(account.id);
      for (const invoice of open) {
        if (!invoice.externalId) continue; // unconfirmed reservation, not a real charge yet
        checked += 1;
        try {
          if (await this.reconcileOne(invoice, account, now)) changed += 1;
        } catch {
          failed += 1;
        }
        await sleep(BILLING_LIMITS.reconciliationCallSpacingMs);
      }
    }
    return { checked, changed, failed };
  }

  private async reconcileOne(
    invoice: Invoice,
    account: BillingAccount,
    now: Date,
  ): Promise<boolean> {
    const charge = await this.accountService.withAccountKey(account, (apiKey) =>
      this.gateway.getCharge(apiKey, invoice.externalId!),
    );
    const transition = applyChargeToInvoice(invoice, charge);
    if (!transition) return false;

    const updated = await this.invoices.transition(
      invoice.id,
      [invoice.status],
      invoiceTransitionToUpdateData(transition),
    );
    if (!updated) return false;

    this.logger.log(
      `invoice_transition from=${invoice.status} to=${transition.status} source=reconciliation`,
    );
    if (transition.status === 'PAID') {
      await this.notify.notifyPaid(updated, account, now);
    } else if (transition.status === 'OVERDUE') {
      await this.notify.notifyOverdue(updated, account, now);
    }
    return true;
  }
}
