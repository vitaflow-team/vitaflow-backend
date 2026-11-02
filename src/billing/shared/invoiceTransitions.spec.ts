import { GatewayCharge } from '@/billing/gateway/paymentGateway';
import { Invoice, InvoiceStatus } from '@prisma/client';
import {
  applyChargeToInvoice,
  financialSituation,
  mirrorBillingStatus,
} from './invoiceTransitions';

function invoiceRow(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    clientId: 'client-1',
    billingAccountId: 'account-1',
    competenceYear: 2026,
    competenceMonth: 11,
    amountCents: 19990,
    dueDate: new Date('2026-11-20T00:00:00.000Z'),
    status: InvoiceStatus.PENDING,
    externalId: 'pay_1',
    paymentUrl: 'https://asaas.test/i/pay_1',
    paidAt: null,
    paidAmountCents: null,
    manualNote: null,
    linkSentAt: null,
    overdueNotifiedAt: null,
    paidNotifiedAt: null,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  } as Invoice;
}

function charge(overrides: Partial<GatewayCharge> = {}): GatewayCharge {
  return {
    externalId: 'pay_1',
    status: 'PENDING',
    rawStatus: 'PENDING',
    valueCents: 19990,
    dueDate: '2026-11-20',
    paymentDate: null,
    ...overrides,
  };
}

describe('applyChargeToInvoice (UT-009)', () => {
  it('a paid gateway status moves pending to paid with the gateway date and amount', () => {
    const transition = applyChargeToInvoice(
      invoiceRow({ status: InvoiceStatus.PENDING }),
      charge({ status: 'PAID', paymentDate: '2026-11-18', valueCents: 25000 }),
    );
    expect(transition).toEqual({
      status: 'PAID',
      paidAt: '2026-11-18',
      paidAmountCents: 25000,
    });
  });

  it('overdue moves pending to overdue', () => {
    const transition = applyChargeToInvoice(
      invoiceRow({ status: InvoiceStatus.PENDING }),
      charge({ status: 'OVERDUE' }),
    );
    expect(transition).toEqual({ status: 'OVERDUE' });
  });

  it('a paid invoice receiving an overdue charge stays paid', () => {
    const transition = applyChargeToInvoice(
      invoiceRow({ status: InvoiceStatus.PAID }),
      charge({ status: 'OVERDUE' }),
    );
    expect(transition).toBeNull();
  });

  it('a deleted charge moves an open invoice to canceled', () => {
    const transition = applyChargeToInvoice(
      invoiceRow({ status: InvoiceStatus.OVERDUE }),
      charge({ status: 'CANCELED' }),
    );
    expect(transition).toEqual({ status: 'CANCELED' });
  });

  it('refund and chargeback statuses change nothing', () => {
    const transition = applyChargeToInvoice(
      invoiceRow({ status: InvoiceStatus.PENDING }),
      charge({ status: 'UNHANDLED', rawStatus: 'REFUNDED' }),
    );
    expect(transition).toBeNull();
  });

  it('a payment for an invoice canceled locally or marked paid manually moves it to paid (the gateway wins)', () => {
    expect(
      applyChargeToInvoice(
        invoiceRow({ status: InvoiceStatus.CANCELED }),
        charge({ status: 'PAID', paymentDate: '2026-11-18' }),
      ),
    ).toEqual({
      status: 'PAID',
      paidAt: '2026-11-18',
      paidAmountCents: 19990,
    });
    expect(
      applyChargeToInvoice(
        invoiceRow({ status: InvoiceStatus.PAID_MANUALLY }),
        charge({ status: 'PAID', paymentDate: '2026-11-18' }),
      ),
    ).toEqual({
      status: 'PAID',
      paidAt: '2026-11-18',
      paidAmountCents: 19990,
    });
  });

  it('a canceled or manually paid invoice is otherwise left alone', () => {
    expect(
      applyChargeToInvoice(
        invoiceRow({ status: InvoiceStatus.CANCELED }),
        charge({ status: 'OVERDUE' }),
      ),
    ).toBeNull();
    expect(
      applyChargeToInvoice(
        invoiceRow({ status: InvoiceStatus.PAID_MANUALLY }),
        charge({ status: 'CANCELED' }),
      ),
    ).toBeNull();
  });

  it('the same status returns no transition', () => {
    expect(
      applyChargeToInvoice(
        invoiceRow({ status: InvoiceStatus.PENDING }),
        charge({ status: 'PENDING' }),
      ),
    ).toBeNull();
    expect(
      applyChargeToInvoice(
        invoiceRow({ status: InvoiceStatus.OVERDUE }),
        charge({ status: 'OVERDUE' }),
      ),
    ).toBeNull();
  });
});

describe('financialSituation (UT-011)', () => {
  it('any overdue gives overdue', () => {
    expect(
      financialSituation([
        invoiceRow({ status: InvoiceStatus.PAID }),
        invoiceRow({ status: InvoiceStatus.OVERDUE }),
        invoiceRow({ status: InvoiceStatus.PENDING }),
      ]),
    ).toBe('OVERDUE');
  });

  it('else any pending gives pending', () => {
    expect(
      financialSituation([
        invoiceRow({ status: InvoiceStatus.PAID }),
        invoiceRow({ status: InvoiceStatus.PENDING }),
      ]),
    ).toBe('PENDING');
  });

  it('else any paid or manually paid gives up to date', () => {
    expect(
      financialSituation([invoiceRow({ status: InvoiceStatus.PAID })]),
    ).toBe('UP_TO_DATE');
    expect(
      financialSituation([invoiceRow({ status: InvoiceStatus.PAID_MANUALLY })]),
    ).toBe('UP_TO_DATE');
  });

  it('else none', () => {
    expect(financialSituation([])).toBe('NONE');
  });

  it('canceled invoices count as nothing', () => {
    expect(
      financialSituation([invoiceRow({ status: InvoiceStatus.CANCELED })]),
    ).toBe('NONE');
  });
});

describe('mirrorBillingStatus (UT-012)', () => {
  it('overdue before pending, then earliest due date', () => {
    const overdueLater = invoiceRow({
      id: 'overdue-later',
      status: InvoiceStatus.OVERDUE,
      dueDate: new Date('2026-10-25T00:00:00.000Z'),
    });
    const pendingEarlier = invoiceRow({
      id: 'pending-earlier',
      status: InvoiceStatus.PENDING,
      dueDate: new Date('2026-11-01T00:00:00.000Z'),
    });
    const result = mirrorBillingStatus([pendingEarlier, overdueLater]);
    expect(result?.openInvoice?.status).toBe(InvoiceStatus.OVERDUE);
  });

  it('otherOpenCount counts the rest', () => {
    const result = mirrorBillingStatus([
      invoiceRow({ id: 'a', status: InvoiceStatus.OVERDUE }),
      invoiceRow({ id: 'b', status: InvoiceStatus.PENDING }),
      invoiceRow({ id: 'c', status: InvoiceStatus.PENDING }),
    ]);
    expect(result?.otherOpenCount).toBe(2);
  });

  it('latestPaid is the most recent paid or manually paid', () => {
    const result = mirrorBillingStatus([
      invoiceRow({
        id: 'older',
        status: InvoiceStatus.PAID,
        paidAt: new Date('2026-09-10T00:00:00.000Z'),
        competenceMonth: 9,
      }),
      invoiceRow({
        id: 'newer',
        status: InvoiceStatus.PAID_MANUALLY,
        paidAt: new Date('2026-10-10T00:00:00.000Z'),
        competenceMonth: 10,
      }),
    ]);
    expect(result?.latestPaid?.competenceMonth).toBe(10);
  });

  it('manually paid and canceled invoices are never the open one', () => {
    const result = mirrorBillingStatus([
      invoiceRow({ id: 'manual', status: InvoiceStatus.PAID_MANUALLY }),
      invoiceRow({ id: 'canceled', status: InvoiceStatus.CANCELED }),
    ]);
    expect(result?.openInvoice).toBeNull();
    expect(result?.otherOpenCount).toBe(0);
  });

  it('no non-canceled invoice gives null', () => {
    expect(mirrorBillingStatus([])).toBeNull();
    expect(
      mirrorBillingStatus([invoiceRow({ status: InvoiceStatus.CANCELED })]),
    ).toBeNull();
  });
});
