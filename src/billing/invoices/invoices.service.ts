import {
  BILLING_CIPHER_KEY,
  BillingAccountService,
} from '@/billing/account/billingAccount.service';
import { PAYMENT_GATEWAY } from '@/billing/gateway/paymentGateway';
import type { PaymentGateway } from '@/billing/gateway/paymentGateway';
import { BILLING_LIMITS } from '@/billing/shared/billingLimits';
import { newInvoiceMessage } from '@/billing/shared/invoiceMessages';
import {
  applyChargeToInvoice,
  financialSituation,
} from '@/billing/shared/invoiceTransitions';
import { isProfessionalPremium } from '@/billing/shared/premiumAccess';
import { decryptSecret, encryptSecret } from '@/billing/shared/secretCipher';
import { parseReaisToCents } from '@/billing/shared/money';
import {
  brasiliaDateKey,
  dateOnlyKey,
  daysBetween,
  parseCalendarDate,
  validateCompetence,
  validateDueDate,
} from '@/billing/shared/dates';
import { maskTaxId, validateTaxId } from '@/billing/shared/taxId';
import { CodedError } from '@/common/errors/codedError';
import { MailService } from '@/mail/mail.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import {
  InvoicesRepository,
  NewInvoiceReservation,
} from '@/repositories/billing/invoices.repository';
import { StudentTaxIdRepository } from '@/repositories/billing/studentTaxId.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BillingAccount,
  Client,
  Invoice,
  InvoiceStatus,
  Prisma,
} from '@prisma/client';
import { CreateInvoiceDTO } from './dto/createInvoice.Dto';
import { InvoiceListResponseDTO } from './dto/invoiceListResponse.Dto';
import { InvoiceResponseDTO } from './dto/invoiceResponse.Dto';
import { MarkPaidDTO } from './dto/markPaid.Dto';
import { TaxIdResponseDTO } from './dto/taxIdResponse.Dto';
import { UpdateInvoiceDTO } from './dto/updateInvoice.Dto';

const OPEN_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.PENDING,
  InvoiceStatus.OVERDUE,
];

const STUDENT_NOT_FOUND = 'Aluno não encontrado.';
const INVOICE_NOT_FOUND = 'Cobrança não encontrada.';
const INVOICE_EXISTS = 'Já existe uma cobrança para esse mês.';
const NOT_OPEN = 'Esta cobrança não pode mais ser alterada.';
const ALREADY_PAID = 'Esta cobrança já foi paga.';
const TAX_ID_REQUIRED = 'Informe o CPF ou CNPJ do aluno.';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly invoices: InvoicesRepository,
    private readonly taxIds: StudentTaxIdRepository,
    private readonly clients: ClientsRepository,
    private readonly accounts: BillingAccountRepository,
    private readonly accountService: BillingAccountService,
    private readonly users: UserRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(BILLING_CIPHER_KEY) private readonly cipherKey: Buffer,
    private readonly mailService: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(
    professionalId: string,
    clientId: string,
    page: number,
  ): Promise<InvoiceListResponseDTO> {
    await this.ownedClient(clientId, professionalId);
    const user = await this.users.findByIdWithProduct(professionalId);
    const account = await this.accounts.findActiveByUser(professionalId);
    const taxId = await this.taxIds.find(clientId);
    const all = await this.invoices.findOpenAndOverdueByClient(clientId);

    const { items, total } = await this.invoices.list(
      clientId,
      page,
      BILLING_LIMITS.invoicePageSize,
    );
    return {
      items: items.map((i) => this.toResponse(i)),
      total,
      page,
      pageSize: BILLING_LIMITS.invoicePageSize,
      situation: financialSituation(all),
      taxId: this.toTaxIdResponse(taxId?.ciphertext ?? null),
      gateway: {
        connected: account !== null && account.apiKeyEncrypted !== null,
        premium: isProfessionalPremium(user),
      },
    };
  }

  async create(
    professionalId: string,
    clientId: string,
    dto: CreateInvoiceDTO,
  ): Promise<InvoiceResponseDTO> {
    const todayKey = brasiliaDateKey(new Date());
    const amountCents = parseReaisToCents(dto.amount);
    const dueDate = validateDueDate(dto.dueDate, todayKey);
    const competence = validateCompetence(
      dto.competenceYear,
      dto.competenceMonth,
      todayKey,
    );

    const client = await this.ownedClient(clientId, professionalId);
    const account = await this.requirePremiumAccount(professionalId);
    const taxDigits = await this.resolveTaxId(clientId, dto.cpfCnpj);

    const reservation = await this.reserveInvoice({
      clientId: client.id,
      billingAccountId: account.id,
      competenceYear: competence.year,
      competenceMonth: competence.month,
      amountCents,
      dueDate,
    });
    const confirmed = await this.chargeReservation(reservation, account, {
      client,
      taxDigits,
    });
    const emailSent = await this.notifyInvoiceCreated(
      confirmed,
      client,
      account.accountName,
    );
    return this.toResponse(confirmed, emailSent);
  }

  async update(
    professionalId: string,
    invoiceId: string,
    dto: UpdateInvoiceDTO,
  ): Promise<InvoiceResponseDTO> {
    const invoice = await this.ownedInvoice(invoiceId, professionalId);
    this.requireOpen(invoice);
    const account = await this.requireAccount(invoice.billingAccountId);
    await this.rejectIfGatewayShowsPaid(invoice, account);

    const todayKey = brasiliaDateKey(new Date());
    const amountCents =
      dto.amount === undefined
        ? invoice.amountCents
        : parseReaisToCents(dto.amount);
    const dueDate =
      dto.dueDate === undefined
        ? dateOnlyKey(invoice.dueDate)
        : validateDueDate(dto.dueDate, todayKey);

    if (
      amountCents === invoice.amountCents &&
      dueDate === this.dueKey(invoice)
    ) {
      return this.toResponse(invoice);
    }

    const newStatus = this.statusAfterDueDateChange(invoice, dueDate, todayKey);
    await this.withGateway(account, (apiKey) =>
      this.gateway.updateCharge(apiKey, invoice.externalId!, {
        amountCents,
        dueDate,
      }),
    );
    const updated = await this.invoices.transition(invoiceId, OPEN_STATUSES, {
      amountCents,
      dueDate: new Date(dueDate),
      status: newStatus,
    });
    if (!updated) throw new CodedError(NOT_OPEN, 409, 'invoice_not_open');
    return this.toResponse(updated);
  }

  async cancel(
    professionalId: string,
    invoiceId: string,
  ): Promise<InvoiceResponseDTO> {
    const invoice = await this.ownedInvoice(invoiceId, professionalId);
    if (invoice.status === InvoiceStatus.CANCELED) {
      return this.toResponse(invoice);
    }
    this.requireOpen(invoice);
    const account = await this.requireAccount(invoice.billingAccountId);
    await this.rejectIfGatewayShowsPaid(invoice, account);

    await this.withGateway(account, (apiKey) =>
      this.gateway.cancelCharge(apiKey, invoice.externalId!),
    );
    const updated = await this.invoices.transition(invoiceId, OPEN_STATUSES, {
      status: InvoiceStatus.CANCELED,
    });
    if (!updated) throw new CodedError(NOT_OPEN, 409, 'invoice_not_open');
    return this.toResponse(updated);
  }

  async markPaid(
    professionalId: string,
    invoiceId: string,
    dto: MarkPaidDTO,
  ): Promise<InvoiceResponseDTO> {
    const invoice = await this.ownedInvoice(invoiceId, professionalId);
    if (invoice.status === InvoiceStatus.PAID_MANUALLY) {
      return this.toResponse(invoice);
    }
    this.requireOpen(invoice);
    const account = await this.requireAccount(invoice.billingAccountId);
    await this.rejectIfGatewayShowsPaid(invoice, account);
    const paidAt = this.validateMarkPaidInput(dto);

    await this.withGateway(account, (apiKey) =>
      this.gateway.cancelCharge(apiKey, invoice.externalId!),
    );
    const updated = await this.invoices.transition(invoiceId, OPEN_STATUSES, {
      status: InvoiceStatus.PAID_MANUALLY,
      paidAt: new Date(paidAt),
      paidAmountCents: invoice.amountCents,
      manualNote: dto.note ?? null,
    });
    if (!updated) throw new CodedError(NOT_OPEN, 409, 'invoice_not_open');
    return this.toResponse(updated);
  }

  async resend(professionalId: string, invoiceId: string): Promise<void> {
    const invoice = await this.ownedInvoice(invoiceId, professionalId);
    this.requireOpen(invoice);

    const now = new Date();
    const windowStart = new Date(
      now.getTime() - BILLING_LIMITS.resendIntervalMinutes * 60_000,
    );
    const claimed = await this.invoices.claimResend(
      invoiceId,
      windowStart,
      now,
    );
    if (!claimed) {
      const minutesLeft = this.minutesUntilResendAllowed(invoice, now);
      throw new CodedError(
        `Aguarde mais ${minutesLeft} minuto(s) para reenviar.`,
        429,
        'resend_too_soon',
        { minutesLeft },
      );
    }

    const client = await this.clients.getClientById(invoice.clientId);
    const account = await this.accounts.findById(invoice.billingAccountId);
    if (client && account) {
      await this.sendLinkEmail(invoice, client, account.accountName);
    }
  }

  async setTaxId(
    professionalId: string,
    clientId: string,
    cpfCnpj: unknown,
  ): Promise<TaxIdResponseDTO> {
    await this.ownedClient(clientId, professionalId);
    const tax = validateTaxId(cpfCnpj);
    await this.taxIds.upsert(
      clientId,
      encryptSecret(tax.digits, this.cipherKey),
    );
    return { present: true, masked: maskTaxId(tax) };
  }

  // --- Ownership and account lookups ---

  private async ownedClient(
    clientId: string,
    professionalId: string,
  ): Promise<Client> {
    const client = await this.clients.findOwnedById(clientId, professionalId);
    if (!client)
      throw new CodedError(STUDENT_NOT_FOUND, 404, 'student_not_found');
    return client;
  }

  private async ownedInvoice(
    invoiceId: string,
    professionalId: string,
  ): Promise<Invoice> {
    const invoice = await this.invoices.findOwned(invoiceId, professionalId);
    if (!invoice)
      throw new CodedError(INVOICE_NOT_FOUND, 404, 'invoice_not_found');
    return invoice;
  }

  // A reservation that never got its gateway charge confirmed (the narrow
  // crash window ADR-009 accepts, cleaned up by the daily job within ten
  // minutes) has no externalId yet — not a real, actionable invoice,
  // so it's treated the same as "not open" rather than reaching a gateway
  // call with a null charge id.
  private requireOpen(invoice: Invoice): void {
    if (!OPEN_STATUSES.includes(invoice.status) || !invoice.externalId) {
      throw new CodedError(NOT_OPEN, 409, 'invoice_not_open');
    }
  }

  // create() needs the Premium check itself: a unit test can call the
  // service directly, bypassing ProfessionalPremiumGuard entirely, so the
  // guard alone is not sufficient defense (UT-055).
  private async requirePremiumAccount(
    professionalId: string,
  ): Promise<BillingAccount> {
    const user = await this.users.findByIdWithProduct(professionalId);
    if (!isProfessionalPremium(user)) {
      throw new CodedError(
        'Este recurso requer o plano Premium.',
        403,
        'premium_required',
      );
    }
    const account = await this.accounts.findActiveByUser(professionalId);
    if (!account) throw this.notConnectedError();
    return account;
  }

  // update/cancel/markPaid already have the invoice's billingAccountId —
  // looked up by id, not by owner, since the professional's account may
  // since have been replaced (ADR-009: a replaced account keeps its key
  // for its own open invoices).
  private async requireAccount(accountId: string): Promise<BillingAccount> {
    const account = await this.accounts.findById(accountId);
    if (!account) throw this.notConnectedError();
    return account;
  }

  private notConnectedError(): CodedError {
    return new CodedError(
      'Conecte sua conta Asaas para continuar.',
      409,
      'gateway_not_connected',
    );
  }

  // --- Gateway calls ---

  // BillingAccountService.withAccountKey already maps the gateway error
  // through mapGatewayError and marks the key invalid on an auth failure —
  // nothing left to do here beyond delegating.
  private async withGateway<T>(
    account: BillingAccount,
    operation: (apiKey: string) => Promise<T>,
  ): Promise<T> {
    return await this.accountService.withAccountKey(account, operation);
  }

  private async rejectIfGatewayShowsPaid(
    invoice: Invoice,
    account: BillingAccount,
  ): Promise<void> {
    if (!invoice.externalId) return;
    const charge = await this.withGateway(account, (apiKey) =>
      this.gateway.getCharge(apiKey, invoice.externalId!),
    );
    const transition = applyChargeToInvoice(invoice, charge);
    if (transition?.status !== 'PAID') return;

    await this.invoices.transition(invoice.id, OPEN_STATUSES, {
      status: InvoiceStatus.PAID,
      paidAt: new Date(transition.paidAt),
      paidAmountCents: transition.paidAmountCents,
    });
    throw new CodedError(ALREADY_PAID, 409, 'invoice_already_paid');
  }

  // --- Create helpers ---

  // Returns the resolved digits so the caller (create) can thread them
  // straight into ensureBillingCustomer without a second, redundant
  // decrypt-from-storage round trip.
  private async resolveTaxId(
    clientId: string,
    cpfCnpj: string | undefined,
  ): Promise<string> {
    const stored = await this.taxIds.find(clientId);
    if (stored) return decryptSecret(stored.ciphertext, this.cipherKey);
    if (!cpfCnpj) {
      throw new CodedError(TAX_ID_REQUIRED, 400, 'tax_id_required');
    }
    const tax = validateTaxId(cpfCnpj);
    await this.taxIds.upsert(
      clientId,
      encryptSecret(tax.digits, this.cipherKey),
    );
    return tax.digits;
  }

  private async reserveInvoice(data: NewInvoiceReservation): Promise<Invoice> {
    try {
      return await this.invoices.reserve(data);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.invoices.findOpenForCompetence(
          data.clientId,
          data.competenceYear,
          data.competenceMonth,
        );
        throw new CodedError(
          INVOICE_EXISTS,
          409,
          'invoice_exists_for_month',
          existing ? { invoiceId: existing.id } : undefined,
        );
      }
      throw error;
    }
  }

  private async chargeReservation(
    reservation: Invoice,
    account: BillingAccount,
    customer: { client: Client; taxDigits: string },
  ): Promise<Invoice> {
    try {
      const customerExternalId = await this.ensureBillingCustomer(
        account,
        customer.client,
        customer.taxDigits,
      );
      const charge = await this.withGateway(account, (apiKey) =>
        this.gateway.createCharge(apiKey, {
          customerExternalId,
          amountCents: reservation.amountCents,
          dueDate: dateOnlyKey(reservation.dueDate),
          description: `Mensalidade com ${account.accountName} — ${reservation.competenceMonth}/${reservation.competenceYear}`,
          externalReference: reservation.id,
        }),
      );
      return await this.invoices.confirmCharge(reservation.id, {
        externalId: charge.externalId,
        paymentUrl: charge.paymentUrl,
      });
    } catch (error) {
      await this.invoices.deleteReservation(reservation.id);
      throw error;
    }
  }

  private async ensureBillingCustomer(
    account: BillingAccount,
    client: Client,
    taxDigits: string,
  ): Promise<string> {
    const existing = await this.invoices.findBillingCustomer(
      account.id,
      client.id,
    );
    if (existing) return existing.externalId;

    const { externalId } = await this.withGateway(account, (apiKey) =>
      this.gateway.ensureCustomer(apiKey, {
        name: client.name,
        cpfCnpj: taxDigits,
        email: client.email,
        externalReference: client.id,
      }),
    );
    await this.invoices.createBillingCustomer(
      account.id,
      client.id,
      externalId,
    );
    return externalId;
  }

  // --- Notifications ---

  private async notifyInvoiceCreated(
    invoice: Invoice,
    client: Client,
    professionalName: string,
  ): Promise<boolean> {
    const emailSent = await this.sendLinkEmail(
      invoice,
      client,
      professionalName,
    );
    if (client.userId) {
      try {
        await this.notifications.create(
          client.userId,
          'BILLING',
          newInvoiceMessage(invoice, professionalName),
          undefined,
          true,
        );
      } catch {
        this.logger.error(
          `invoice_notification_failed invoiceId=${invoice.id}`,
        );
      }
    }
    return emailSent;
  }

  private async sendLinkEmail(
    invoice: Invoice,
    client: Client,
    professionalName: string,
  ): Promise<boolean> {
    if (!client.email || !invoice.paymentUrl) return false;
    try {
      await this.mailService.sendNotificationEmail(
        client.name,
        client.email,
        'Nova cobrança Vita Flow',
        newInvoiceMessage(invoice, professionalName),
        invoice.paymentUrl,
      );
      return true;
    } catch {
      this.logger.error(`invoice_email_failed invoiceId=${invoice.id}`);
      return false;
    }
  }

  // --- Small pure computations ---

  private dueKey(invoice: Invoice): string {
    return dateOnlyKey(invoice.dueDate);
  }

  private statusAfterDueDateChange(
    invoice: Invoice,
    newDueDate: string,
    todayKey: string,
  ): InvoiceStatus {
    if (invoice.status !== InvoiceStatus.OVERDUE) return invoice.status;
    return daysBetween(todayKey, newDueDate) >= 0
      ? InvoiceStatus.PENDING
      : InvoiceStatus.OVERDUE;
  }

  private validateMarkPaidInput(dto: MarkPaidDTO): string {
    const todayKey = brasiliaDateKey(new Date());
    const paidAt = parseCalendarDate(dto.paidOn);
    if (!paidAt || daysBetween(todayKey, paidAt) > 0) {
      throw new CodedError(
        'A data de pagamento não pode ser no futuro.',
        400,
        'invoice_invalid',
      );
    }
    if (dto.note && dto.note.length > BILLING_LIMITS.manualNoteMaxLength) {
      throw new CodedError(
        `A nota pode ter no máximo ${BILLING_LIMITS.manualNoteMaxLength} caracteres.`,
        400,
        'invoice_invalid',
      );
    }
    return paidAt;
  }

  private minutesUntilResendAllowed(invoice: Invoice, now: Date): number {
    if (!invoice.linkSentAt) return 0;
    const elapsedMs = now.getTime() - invoice.linkSentAt.getTime();
    const remainingMs =
      BILLING_LIMITS.resendIntervalMinutes * 60_000 - elapsedMs;
    return Math.max(1, Math.ceil(remainingMs / 60_000));
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private toResponse(
    invoice: Invoice,
    emailSent?: boolean,
  ): InvoiceResponseDTO {
    const canResendAt = invoice.linkSentAt
      ? new Date(
          invoice.linkSentAt.getTime() +
            BILLING_LIMITS.resendIntervalMinutes * 60_000,
        ).toISOString()
      : null;
    return {
      id: invoice.id,
      competenceYear: invoice.competenceYear,
      competenceMonth: invoice.competenceMonth,
      amountCents: invoice.amountCents,
      dueDate: dateOnlyKey(invoice.dueDate),
      status: invoice.status,
      paidAt: invoice.paidAt ? dateOnlyKey(invoice.paidAt) : null,
      paidAmountCents: invoice.paidAmountCents,
      manualNote: invoice.manualNote,
      paymentUrl: invoice.paymentUrl,
      canResendAt,
      emailSent,
    };
  }

  private toTaxIdResponse(ciphertext: string | null): TaxIdResponseDTO {
    if (!ciphertext) return { present: false, masked: null };
    const digits = decryptSecret(ciphertext, this.cipherKey);
    const kind = digits.length === 11 ? 'CPF' : 'CNPJ';
    return { present: true, masked: maskTaxId({ kind, digits }) };
  }
}
