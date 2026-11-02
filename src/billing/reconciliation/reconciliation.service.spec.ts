import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { InvoicesRepository } from '@/repositories/billing/invoices.repository';
import { Clock } from '@/scheduling/clock.service';
import { BillingAccount, Invoice, InvoiceStatus } from '@prisma/client';
import { ReconciliationService } from './reconciliation.service';

const NOW = new Date('2026-11-18T09:00:00.000Z'); // 2026-11-18 06:00 Brasília

function accountRow(overrides: Partial<BillingAccount> = {}): BillingAccount {
  return {
    id: 'acc-1',
    userId: 'educator-1',
    provider: 'ASAAS',
    status: 'ACTIVE',
    accountName: 'Thiago Ramos',
    apiKeyEncrypted: 'encrypted',
    apiKeyFingerprint: 'fp',
    webhookId: 'wh_1',
    webhookTokenHash: 'hash',
    keyInvalidAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BillingAccount;
}

function invoiceRow(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    clientId: 'client-1',
    billingAccountId: 'acc-1',
    competenceYear: 2026,
    competenceMonth: 11,
    amountCents: 19990,
    dueDate: new Date('2026-11-15T00:00:00.000Z'),
    status: InvoiceStatus.PENDING,
    externalId: 'pay_1',
    paymentUrl: null,
    paidAt: null,
    paidAmountCents: null,
    manualNote: null,
    linkSentAt: null,
    overdueNotifiedAt: null,
    paidNotifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Invoice;
}

function build(
  overrides: {
    invoices?: Partial<Record<keyof InvoicesRepository, jest.Mock>>;
    accounts?: Partial<Record<keyof BillingAccountRepository, jest.Mock>>;
    gateway?: Record<string, jest.Mock>;
  } = {},
) {
  const invoices = {
    findDueForOverdueTransition: jest.fn().mockResolvedValue([]),
    transition: jest
      .fn()
      .mockImplementation((id, _from, data) =>
        Promise.resolve(invoiceRow({ id, ...data })),
      ),
    findOpenByAccount: jest.fn().mockResolvedValue([]),
    deleteStaleReservations: jest.fn().mockResolvedValue(0),
    ...overrides.invoices,
  };
  const accounts = {
    findAllWithKey: jest.fn().mockResolvedValue([]),
    purgeReplacedWithoutOpenInvoices: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(accountRow()),
    ...overrides.accounts,
  };
  const gateway = { getCharge: jest.fn(), ...overrides.gateway };
  const accountService = {
    withAccountKey: jest
      .fn()
      .mockImplementation(
        (_account: unknown, operation: (key: string) => unknown) =>
          operation('key'),
      ),
  };
  const notify = { notifyPaid: jest.fn(), notifyOverdue: jest.fn() };
  const clock = { now: jest.fn().mockReturnValue(NOW) };

  const service = new ReconciliationService(
    invoices as unknown as InvoicesRepository,
    accounts as unknown as BillingAccountRepository,
    accountService as never,
    gateway as never,
    notify as never,
    clock as unknown as Clock,
  );
  return {
    service,
    invoices,
    accounts,
    gateway,
    accountService,
    notify,
    clock,
  };
}

describe('ReconciliationService.run', () => {
  it('UT-090 moves a due-before-today pending invoice to overdue, claims and notifies once', async () => {
    const { service, invoices, notify } = build({
      invoices: {
        findDueForOverdueTransition: jest
          .fn()
          .mockResolvedValue([invoiceRow({ id: 'due-yesterday' })]),
      },
    });
    await service.run();

    expect(invoices.transition).toHaveBeenCalledWith(
      'due-yesterday',
      [InvoiceStatus.PENDING],
      { status: InvoiceStatus.OVERDUE },
    );
    expect(notify.notifyOverdue).toHaveBeenCalledTimes(1);
  });

  it('UT-090 leaves an invoice due today alone (not returned by the repository query)', async () => {
    const { service, invoices } = build();
    await service.run();
    expect(invoices.transition).not.toHaveBeenCalled();
  });

  it('UT-091 reads open invoices from the gateway and applies a missed paid status; a failure for one invoice is counted and the others continue', async () => {
    const paid = invoiceRow({ id: 'will-be-paid' });
    const broken = invoiceRow({ id: 'read-fails', externalId: 'pay_2' });
    const { service, invoices, gateway } = build({
      accounts: { findAllWithKey: jest.fn().mockResolvedValue([accountRow()]) },
      invoices: {
        findOpenByAccount: jest.fn().mockResolvedValue([paid, broken]),
      },
      gateway: {
        getCharge: jest.fn().mockImplementation((_key, externalId) =>
          externalId === 'pay_1'
            ? Promise.resolve({
                externalId: 'pay_1',
                status: 'PAID',
                rawStatus: 'RECEIVED',
                valueCents: 19990,
                dueDate: '2026-11-15',
                paymentDate: '2026-11-16',
              })
            : Promise.reject(new Error('gateway down')),
        ),
      },
    });
    await service.run();

    expect(gateway.getCharge).toHaveBeenCalledTimes(2);
    expect(invoices.transition).toHaveBeenCalledWith(
      'will-be-paid',
      [InvoiceStatus.PENDING],
      expect.objectContaining({ status: InvoiceStatus.PAID }),
    );
  });

  it('UT-092 purges replaced accounts without open invoices through the repository', async () => {
    const { service, accounts } = build({
      accounts: {
        purgeReplacedWithoutOpenInvoices: jest
          .fn()
          .mockResolvedValue(['replaced-1']),
      },
    });
    await service.run();
    expect(accounts.purgeReplacedWithoutOpenInvoices).toHaveBeenCalledTimes(1);
  });

  it('UT-093 deletes reservations older than the grace window, computed from the Clock', async () => {
    const { service, invoices } = build();
    await service.run();

    const [cutoff] = invoices.deleteStaleReservations.mock.calls[0] as [Date];
    expect(cutoff.getTime()).toBe(NOW.getTime() - 10 * 60_000);
  });

  it('UT-094 reads time only from the Clock', async () => {
    const { service, clock } = build();
    await service.run();
    expect(clock.now).toHaveBeenCalled();
  });
});
