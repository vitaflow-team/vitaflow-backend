import { GatewayCharge } from '@/billing/gateway/paymentGateway';
import { Invoice, InvoiceStatus, Prisma } from '@prisma/client';
import { dateOnlyKey } from './dates';

export type FinancialSituation = 'OVERDUE' | 'PENDING' | 'UP_TO_DATE' | 'NONE';

export type InvoiceTransition =
  | { status: 'PAID'; paidAt: string; paidAmountCents: number }
  | { status: 'OVERDUE' }
  | { status: 'CANCELED' };

export interface StudentBillingStatusDTO {
  openInvoice: {
    competenceYear: number;
    competenceMonth: number;
    amountCents: number;
    dueDate: string;
    status: InvoiceStatus;
    paymentUrl: string | null;
  } | null;
  otherOpenCount: number;
  latestPaid: {
    competenceYear: number;
    competenceMonth: number;
    amountCents: number;
    paidAt: string | null;
  } | null;
}

const OPEN_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.PENDING,
  InvoiceStatus.OVERDUE,
];

// What the gateway's view of a charge means for the invoice that tracks it —
// pure, so task_02's create/update/cancel/markPaid "gateway's payment wins"
// checks and task_03's webhook/daily-reconciliation transitions share one
// rule instead of two drifting copies (ADR-002 decision 6, ADR-009 decision
// 7: every status write is conditional on the previous status).
//
// Only PAID and CANCELED are decided here: both of those outcomes end an
// open invoice regardless of why, and that is exactly what task_02's
// "read the charge, if it already shows paid, apply paid" checks need. An
// overdue-by-date transition for a merely pending, unreported charge is the
// daily job's own concern (task_03) — it has no GatewayCharge to read from,
// only the stored due date, so it does not belong in this function's input.
export function applyChargeToInvoice(
  invoice: Pick<Invoice, 'status'>,
  charge: GatewayCharge,
): InvoiceTransition | null {
  // PAID is the one true terminal state (never leave a paid invoice).
  if (invoice.status === InvoiceStatus.PAID) return null;

  // The gateway's payment always wins, even over a local cancel or a
  // manual mark outside the gateway (ADR-002 decision 6, IT-019) — this
  // check runs before the open-only guard below on purpose.
  if (charge.status === 'PAID') {
    return {
      status: 'PAID',
      paidAt: charge.paymentDate ?? charge.dueDate,
      paidAmountCents: charge.valueCents,
    };
  }

  // Everything else only moves an invoice that is still open: a closed
  // (CANCELED/PAID_MANUALLY) invoice can only be reopened by a real
  // payment, handled above.
  if (!OPEN_STATUSES.includes(invoice.status)) return null;

  if (charge.status === 'CANCELED') {
    return { status: 'CANCELED' };
  }
  if (charge.status === 'OVERDUE' && invoice.status !== InvoiceStatus.OVERDUE) {
    return { status: 'OVERDUE' };
  }
  // PENDING (not yet due per the gateway) and UNHANDLED (refunds,
  // chargebacks, anything mapChargeStatus doesn't recognize) change
  // nothing — the caller logs UNHANDLED separately for visibility.
  return null;
}

// Maps a decided transition to the conditional update data every caller
// (task_02's own checks, the webhook, the daily job) applies the same way
// through InvoicesRepository.transition.
export function invoiceTransitionToUpdateData(
  transition: InvoiceTransition,
): Prisma.InvoiceUpdateInput {
  if (transition.status === 'PAID') {
    return {
      status: InvoiceStatus.PAID,
      paidAt: new Date(transition.paidAt),
      paidAmountCents: transition.paidAmountCents,
    };
  }
  if (transition.status === 'OVERDUE') {
    return { status: InvoiceStatus.OVERDUE };
  }
  return { status: InvoiceStatus.CANCELED };
}

// The mirror's own selection (UT-012): among open invoices, overdue first
// then the earliest due date is "the" open invoice; the rest are just a
// count. The latest paid (by paid date) is reported separately and
// independently of whether there is a currently open invoice. Manually
// paid counts as paid; canceled invoices never appear here at all.
export function mirrorBillingStatus(
  invoices: Invoice[],
): StudentBillingStatusDTO | null {
  const relevant = invoices.filter((i) => i.status !== InvoiceStatus.CANCELED);
  if (relevant.length === 0) return null;

  const open = relevant
    .filter((i) => OPEN_STATUSES.includes(i.status))
    .sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === InvoiceStatus.OVERDUE ? -1 : 1;
      }
      return a.dueDate.getTime() - b.dueDate.getTime();
    });
  const [selected, ...rest] = open;

  const paid = relevant
    .filter(
      (i) =>
        i.status === InvoiceStatus.PAID ||
        i.status === InvoiceStatus.PAID_MANUALLY,
    )
    .sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0));
  const latestPaid = paid[0];

  return {
    openInvoice: selected
      ? {
          competenceYear: selected.competenceYear,
          competenceMonth: selected.competenceMonth,
          amountCents: selected.amountCents,
          dueDate: dateOnlyKey(selected.dueDate),
          status: selected.status,
          paymentUrl: selected.paymentUrl,
        }
      : null,
    otherOpenCount: rest.length,
    latestPaid: latestPaid
      ? {
          competenceYear: latestPaid.competenceYear,
          competenceMonth: latestPaid.competenceMonth,
          amountCents: latestPaid.amountCents,
          paidAt: latestPaid.paidAt ? dateOnlyKey(latestPaid.paidAt) : null,
        }
      : null,
  };
}

// Any overdue invoice wins, then any pending, then any paid; a student with
// no non-canceled invoice at all has no situation to report.
export function financialSituation(
  invoices: Pick<Invoice, 'status'>[],
): FinancialSituation {
  if (invoices.some((i) => i.status === InvoiceStatus.OVERDUE))
    return 'OVERDUE';
  if (invoices.some((i) => i.status === InvoiceStatus.PENDING))
    return 'PENDING';
  if (
    invoices.some(
      (i) =>
        i.status === InvoiceStatus.PAID ||
        i.status === InvoiceStatus.PAID_MANUALLY,
    )
  )
    return 'UP_TO_DATE';
  return 'NONE';
}
