import { BillingAccountService } from '@/billing/account/billingAccount.service';
import { PAYMENT_GATEWAY } from '@/billing/gateway/paymentGateway';
import type {
  GatewayCharge,
  PaymentGateway,
} from '@/billing/gateway/paymentGateway';
import { hashWebhookToken } from '@/billing/shared/credentials';
import {
  applyChargeToInvoice,
  invoiceTransitionToUpdateData,
} from '@/billing/shared/invoiceTransitions';
import { InvoiceNotifications } from '@/billing/shared/invoiceNotifications.service';
import { CodedError } from '@/common/errors/codedError';
import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { InvoicesRepository } from '@/repositories/billing/invoices.repository';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { BillingAccount, Invoice } from '@prisma/client';

const GENERIC_UNAUTHORIZED =
  'Não foi possível autenticar a notificação do gateway.';
const CHARGE_READ_FAILED = 'O Asaas está indisponível no momento.';

function extractChargeExternalId(body: unknown): string | null {
  const payment = (body as { payment?: { id?: unknown } } | null)?.payment;
  return typeof payment?.id === 'string' ? payment.id : null;
}

@Injectable()
export class AsaasWebhookService {
  private readonly logger = new Logger(AsaasWebhookService.name);

  constructor(
    private readonly accounts: BillingAccountRepository,
    private readonly invoices: InvoicesRepository,
    private readonly accountService: BillingAccountService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly notify: InvoiceNotifications,
  ) {}

  // Authenticate, read the charge from the gateway (the notice itself is
  // only a hint — ADR-007), find the invoice by account and charge id, and
  // apply the conditional transition. Always 200 once authenticated, except
  // a failed charge read (503, so the gateway retries).
  async handle(tokenHeader: unknown, body: unknown): Promise<void> {
    const account = await this.authenticate(tokenHeader);

    const externalId = extractChargeExternalId(body);
    if (!externalId) {
      this.logger.log('webhook_received accepted=true reason=no_charge_id');
      return;
    }

    const charge = await this.readCharge(account, externalId);

    const invoice = await this.invoices.findByExternalId(
      account.id,
      externalId,
    );
    if (!invoice) {
      this.logger.log(`webhook_unknown_charge accountId=${account.id}`);
      return;
    }

    await this.applyAndNotify(invoice, account, charge);
    this.logger.log('webhook_received accepted=true');
  }

  // Hashes the header and finds the account before any gateway call, so an
  // unauthenticated notice never costs a gateway read. A repeated header
  // arrives as an array and is rejected the same way a missing one is.
  private async authenticate(tokenHeader: unknown): Promise<BillingAccount> {
    if (typeof tokenHeader !== 'string' || tokenHeader.length === 0) {
      throw new CodedError(GENERIC_UNAUTHORIZED, 401, 'webhook_unauthorized');
    }
    const account = await this.accounts.findByWebhookTokenHash(
      hashWebhookToken(tokenHeader),
    );
    if (!account) {
      throw new CodedError(GENERIC_UNAUTHORIZED, 401, 'webhook_unauthorized');
    }
    return account;
  }

  private async readCharge(
    account: BillingAccount,
    externalId: string,
  ): Promise<GatewayCharge> {
    try {
      return await this.accountService.withAccountKey(account, (apiKey) =>
        this.gateway.getCharge(apiKey, externalId),
      );
    } catch {
      this.logger.error(
        `webhook_received accepted=true chargeReadFailed=true accountId=${account.id}`,
      );
      // Uniformly 503 regardless of the gateway's own error kind (auth,
      // validation, unavailable): the notice's only recourse is a retry.
      throw new CodedError(CHARGE_READ_FAILED, 503, 'gateway_unavailable');
    }
  }

  private async applyAndNotify(
    invoice: Invoice,
    account: BillingAccount,
    charge: GatewayCharge,
  ): Promise<void> {
    const transition = applyChargeToInvoice(invoice, charge);
    if (!transition) {
      if (charge.status === 'UNHANDLED') {
        this.logger.log(
          `invoice_transition from=${invoice.status} to=unhandled source=webhook`,
        );
      }
      return;
    }

    const updated = await this.invoices.transition(
      invoice.id,
      [invoice.status],
      invoiceTransitionToUpdateData(transition),
    );
    if (!updated) return;

    this.logger.log(
      `invoice_transition from=${invoice.status} to=${transition.status} source=webhook`,
    );

    const now = new Date();
    if (transition.status === 'PAID') {
      await this.notify.notifyPaid(updated, account, now);
    } else if (transition.status === 'OVERDUE') {
      await this.notify.notifyOverdue(updated, account, now);
    }
  }
}
