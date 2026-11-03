import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import {
  BillingCustomer,
  Invoice,
  InvoiceStatus,
  Prisma,
} from '@prisma/client';

const OPEN_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.PENDING,
  InvoiceStatus.OVERDUE,
];

export interface NewInvoiceReservation {
  clientId: string;
  billingAccountId: string;
  competenceYear: number;
  competenceMonth: number;
  amountCents: number;
  dueDate: string;
}

@Injectable()
export class InvoicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // The reservation row (ADR-009): PENDING, no externalId yet. The caller
  // catches the unique-index violation (P2002) on a simultaneous second
  // request for the same client/competence — the same pattern
  // BillingAccountService.connect already uses for its own unique index,
  // not duplicated here.
  async reserve(data: NewInvoiceReservation): Promise<Invoice> {
    return await this.prisma.invoice.create({
      data: { ...data, dueDate: new Date(data.dueDate) },
    });
  }

  async confirmCharge(
    id: string,
    data: { externalId: string; paymentUrl: string },
  ): Promise<Invoice> {
    return await this.prisma.invoice.update({ where: { id }, data });
  }

  async deleteReservation(id: string): Promise<void> {
    await this.prisma.invoice.delete({ where: { id } });
  }

  // Names the existing invoice for the 409 invoice_exists_for_month error.
  async findOpenForCompetence(
    clientId: string,
    competenceYear: number,
    competenceMonth: number,
  ): Promise<Invoice | null> {
    return await this.prisma.invoice.findFirst({
      where: {
        clientId,
        competenceYear,
        competenceMonth,
        status: { not: InvoiceStatus.CANCELED },
      },
    });
  }

  // An invoice only if its billing account belongs to this professional —
  // a foreign or missing id both resolve to null (ClientsRepository.findOwnedById's
  // pattern, applied here through the account relation).
  async findOwned(id: string, professionalId: string): Promise<Invoice | null> {
    return await this.prisma.invoice.findFirst({
      where: { id, billingAccount: { userId: professionalId } },
    });
  }

  async list(
    clientId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: Invoice[]; total: number }> {
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { clientId },
        orderBy: [{ competenceYear: 'desc' }, { competenceMonth: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.invoice.count({ where: { clientId } }),
    ]);
    return { items, total };
  }

  async findOpenAndOverdueByClient(clientId: string): Promise<Invoice[]> {
    return await this.prisma.invoice.findMany({
      where: { clientId, status: { in: OPEN_STATUSES } },
      orderBy: { dueDate: 'asc' },
    });
  }

  // Every non-canceled invoice of a student, for the mirror's own selection
  // (overdue/pending/paid all matter there, unlike the open-only query above).
  async findNonCanceledByClient(clientId: string): Promise<Invoice[]> {
    return await this.prisma.invoice.findMany({
      where: { clientId, status: { not: InvoiceStatus.CANCELED } },
    });
  }

  // Batch form of the above for the E1 list: every non-canceled invoice of
  // several students in one query, grouped by the caller.
  async findNonCanceledByClients(clientIds: string[]): Promise<Invoice[]> {
    if (clientIds.length === 0) return [];
    return await this.prisma.invoice.findMany({
      where: {
        clientId: { in: clientIds },
        status: { not: InvoiceStatus.CANCELED },
      },
    });
  }

  // The webhook's own lookup (ADR-007): the notice names a charge, never an
  // invoice id directly — matches the schema's own @@unique.
  async findByExternalId(
    billingAccountId: string,
    externalId: string,
  ): Promise<Invoice | null> {
    return await this.prisma.invoice.findUnique({
      where: { billingAccountId_externalId: { billingAccountId, externalId } },
    });
  }

  // Pending invoices whose due date has already passed the given Brasília
  // calendar date — the daily job's local overdue rule (UT-010). `dueDate`
  // is a @db.Date column (midnight UTC of the calendar day); `todayKey` is
  // compared the same way dateOnlyKey/parseCalendarDate round-trip it.
  async findDueForOverdueTransition(todayKey: string): Promise<Invoice[]> {
    return await this.prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.PENDING,
        dueDate: { lt: new Date(`${todayKey}T00:00:00.000Z`) },
      },
    });
  }

  async findOpenByAccount(billingAccountId: string): Promise<Invoice[]> {
    return await this.prisma.invoice.findMany({
      where: { billingAccountId, status: { in: OPEN_STATUSES } },
    });
  }

  // A reservation the crash window left behind (ADR-009): no charge id,
  // old enough that it can no longer be a request still in flight.
  async deleteStaleReservations(before: Date): Promise<number> {
    const { count } = await this.prisma.invoice.deleteMany({
      where: { externalId: null, createdAt: { lt: before } },
    });
    return count;
  }

  // Notify-once claim (ADR-003/ADR-007): an atomic "set if still null" on
  // one of the two notification columns, shared by the webhook and the
  // daily job so the same event is never claimed twice across either path.
  async claimNotification(
    id: string,
    field: 'overdueNotifiedAt' | 'paidNotifiedAt',
    now: Date,
  ): Promise<boolean> {
    const { count } = await this.prisma.invoice.updateMany({
      where: { id, [field]: null },
      data: { [field]: now },
    });
    return count === 1;
  }

  // Every status write is conditional on the previous status (ADR-009
  // decision 7): matches only the invoice in `fromStatuses`, so two
  // concurrent actions — an edit and a webhook's "already paid", or two
  // edits from two tabs (UT-066, IT-007) — can never both succeed. One
  // generic method instead of a near-duplicate per transition (open→edited,
  // open→canceled, open→paid-manually, open→paid-from-gateway).
  async transition(
    id: string,
    fromStatuses: InvoiceStatus[],
    data: Prisma.InvoiceUpdateInput,
  ): Promise<Invoice | null> {
    const { count } = await this.prisma.invoice.updateMany({
      where: { id, status: { in: fromStatuses } },
      data,
    });
    if (count === 0) return null;
    return await this.prisma.invoice.findUniqueOrThrow({ where: { id } });
  }

  // Claims the resend window with the same conditional-write shape: only an
  // invoice whose linkSentAt is null or older than `windowStart` is claimed,
  // so two near-simultaneous resend clicks never both succeed (UT-014).
  async claimResend(
    id: string,
    windowStart: Date,
    now: Date,
  ): Promise<boolean> {
    const { count } = await this.prisma.invoice.updateMany({
      where: {
        id,
        status: { in: OPEN_STATUSES },
        OR: [{ linkSentAt: null }, { linkSentAt: { lt: windowStart } }],
      },
      data: { linkSentAt: now },
    });
    return count === 1;
  }

  async findBillingCustomer(
    billingAccountId: string,
    clientId: string,
  ): Promise<BillingCustomer | null> {
    return await this.prisma.billingCustomer.findUnique({
      where: { billingAccountId_clientId: { billingAccountId, clientId } },
    });
  }

  async createBillingCustomer(
    billingAccountId: string,
    clientId: string,
    externalId: string,
  ): Promise<BillingCustomer> {
    return await this.prisma.billingCustomer.create({
      data: { billingAccountId, clientId, externalId },
    });
  }
}
