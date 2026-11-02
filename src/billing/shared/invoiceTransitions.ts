import { GatewayCharge } from '@/billing/gateway/paymentGateway';
import { Invoice, InvoiceStatus } from '@prisma/client';

export type FinancialSituation = 'OVERDUE' | 'PENDING' | 'UP_TO_DATE' | 'NONE';

export type InvoiceTransition =
  | { status: 'PAID'; paidAt: string; paidAmountCents: number }
  | { status: 'OVERDUE' }
  | { status: 'CANCELED' };

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
  if (!OPEN_STATUSES.includes(invoice.status)) return null;

  if (charge.status === 'PAID') {
    return {
      status: 'PAID',
      paidAt: charge.paymentDate ?? charge.dueDate,
      paidAmountCents: charge.valueCents,
    };
  }
  if (charge.status === 'CANCELED') {
    return { status: 'CANCELED' };
  }
  return null;
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
