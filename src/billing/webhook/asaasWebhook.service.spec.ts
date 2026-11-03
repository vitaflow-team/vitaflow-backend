import { hashWebhookToken } from '@/billing/shared/credentials';
import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { InvoicesRepository } from '@/repositories/billing/invoices.repository';
import { BillingAccount, Invoice, InvoiceStatus } from '@prisma/client';
import { AsaasWebhookService } from './asaasWebhook.service';

const TOKEN = 'webhook-token-abc';
const TOKEN_HASH = hashWebhookToken(TOKEN);

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
    webhookTokenHash: TOKEN_HASH,
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Invoice;
}

function build(
  overrides: {
    accounts?: Partial<Record<keyof BillingAccountRepository, jest.Mock>>;
    invoices?: Partial<Record<keyof InvoicesRepository, jest.Mock>>;
    gateway?: Record<string, jest.Mock>;
  } = {},
) {
  const accounts = {
    findByWebhookTokenHash: jest.fn().mockResolvedValue(accountRow()),
    ...overrides.accounts,
  };
  const invoices = {
    findByExternalId: jest.fn().mockResolvedValue(invoiceRow()),
    transition: jest
      .fn()
      .mockImplementation((id, _from, data) =>
        Promise.resolve(invoiceRow({ id, ...data })),
      ),
    claimNotification: jest.fn().mockResolvedValue(true),
    ...overrides.invoices,
  };
  const gateway = {
    getCharge: jest.fn().mockResolvedValue({
      externalId: 'pay_1',
      status: 'PAID',
      rawStatus: 'RECEIVED',
      valueCents: 19990,
      dueDate: '2026-11-20',
      paymentDate: '2026-11-18',
    }),
    ...overrides.gateway,
  };
  const withAccountKey = jest
    .fn()
    .mockImplementation(
      (_account: unknown, operation: (key: string) => unknown) =>
        operation('decrypted-key'),
    );
  const accountService = { withAccountKey };
  const notify = { notifyPaid: jest.fn(), notifyOverdue: jest.fn() };

  const service = new AsaasWebhookService(
    accounts as unknown as BillingAccountRepository,
    invoices as unknown as InvoicesRepository,
    accountService as never,
    gateway as never,
    notify as never,
  );
  return { service, accounts, invoices, gateway, accountService, notify };
}

describe('AsaasWebhookService.handle', () => {
  const body = { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } };

  it('UT-080 rejects a missing token with the generic 401 and reads nothing from the gateway', async () => {
    const { service, accounts, gateway } = build();
    await expect(service.handle(undefined, body)).rejects.toMatchObject({
      code: 'webhook_unauthorized',
    });
    expect(accounts.findByWebhookTokenHash).not.toHaveBeenCalled();
    expect(gateway.getCharge).not.toHaveBeenCalled();
  });

  it('UT-080 rejects a wrong token with the generic 401', async () => {
    const { service, accounts } = build({
      accounts: { findByWebhookTokenHash: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.handle('wrong-token', body)).rejects.toMatchObject({
      code: 'webhook_unauthorized',
    });
    expect(accounts.findByWebhookTokenHash).toHaveBeenCalled();
  });

  it('UT-080 rejects a repeated header (array) the same way', async () => {
    const { service, gateway } = build();
    await expect(service.handle([TOKEN, TOKEN], body)).rejects.toMatchObject({
      code: 'webhook_unauthorized',
    });
    expect(gateway.getCharge).not.toHaveBeenCalled();
  });

  it('UT-080 rejects a token belonging to an account without a key', async () => {
    const { service } = build({
      accounts: { findByWebhookTokenHash: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.handle(TOKEN, body)).rejects.toMatchObject({
      code: 'webhook_unauthorized',
    });
  });

  it('UT-081 a valid payment notice reads the charge, moves to paid, and notifies the professional once', async () => {
    const { service, invoices, notify } = build();
    await service.handle(TOKEN, body);

    expect(invoices.transition).toHaveBeenCalledWith(
      'inv-1',
      [InvoiceStatus.PENDING],
      expect.objectContaining({
        status: InvoiceStatus.PAID,
        paidAmountCents: 19990,
      }),
    );
    expect(notify.notifyPaid).toHaveBeenCalledTimes(1);
  });

  it('UT-081 a repeated notice changes nothing and notifies nothing', async () => {
    const { service, invoices, notify } = build({
      invoices: {
        findByExternalId: jest
          .fn()
          .mockResolvedValue(invoiceRow({ status: InvoiceStatus.PAID })),
        transition: jest.fn(),
      },
    });
    await service.handle(TOKEN, body);

    expect(invoices.transition).not.toHaveBeenCalled();
    expect(notify.notifyPaid).not.toHaveBeenCalled();
  });

  it('UT-082 an overdue notice arriving after a payment notice leaves the invoice paid', async () => {
    const { service, invoices } = build({
      invoices: {
        findByExternalId: jest
          .fn()
          .mockResolvedValue(invoiceRow({ status: InvoiceStatus.PAID })),
        transition: jest.fn(),
      },
      gateway: {
        getCharge: jest.fn().mockResolvedValue({
          externalId: 'pay_1',
          status: 'OVERDUE',
          rawStatus: 'OVERDUE',
          valueCents: 19990,
          dueDate: '2026-11-20',
          paymentDate: null,
        }),
      },
    });
    await service.handle(TOKEN, body);
    expect(invoices.transition).not.toHaveBeenCalled();
  });

  it('UT-083 a notice for a charge no invoice has answers success and changes nothing', async () => {
    const { service, invoices } = build({
      invoices: { findByExternalId: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.handle(TOKEN, body)).resolves.toBeUndefined();
    expect(invoices.transition).not.toHaveBeenCalled();
  });

  it('UT-084 a payment whose amount differs from the invoice records the gateway amount', async () => {
    const { service, invoices } = build({
      gateway: {
        getCharge: jest.fn().mockResolvedValue({
          externalId: 'pay_1',
          status: 'PAID',
          rawStatus: 'RECEIVED',
          valueCents: 25000,
          dueDate: '2026-11-20',
          paymentDate: '2026-11-18',
        }),
      },
    });
    await service.handle(TOKEN, body);
    expect(invoices.transition).toHaveBeenCalledWith(
      'inv-1',
      [InvoiceStatus.PENDING],
      expect.objectContaining({ paidAmountCents: 25000 }),
    );
  });

  it('UT-085 a payment for an invoice canceled locally but paid at the gateway moves it to paid and notifies the professional', async () => {
    const { service, invoices, notify } = build({
      invoices: {
        findByExternalId: jest
          .fn()
          .mockResolvedValue(invoiceRow({ status: InvoiceStatus.CANCELED })),
        transition: jest
          .fn()
          .mockImplementation((id, _from, data) =>
            Promise.resolve(invoiceRow({ id, ...data })),
          ),
      },
    });
    await service.handle(TOKEN, body);
    expect(invoices.transition).toHaveBeenCalledWith(
      'inv-1',
      [InvoiceStatus.CANCELED],
      expect.objectContaining({ status: InvoiceStatus.PAID }),
    );
    expect(notify.notifyPaid).toHaveBeenCalledTimes(1);
  });

  it('UT-086 a notice claiming payment while the charge is still pending at the gateway changes nothing', async () => {
    const { service, invoices } = build({
      gateway: {
        getCharge: jest.fn().mockResolvedValue({
          externalId: 'pay_1',
          status: 'PENDING',
          rawStatus: 'PENDING',
          valueCents: 19990,
          dueDate: '2026-11-20',
          paymentDate: null,
        }),
      },
    });
    await service.handle(TOKEN, body);
    expect(invoices.transition).not.toHaveBeenCalled();
  });

  it('UT-087 answers 503 when reading the charge fails, and nothing changes', async () => {
    const { service, invoices } = build({
      gateway: { getCharge: jest.fn().mockRejectedValue(new Error('down')) },
    });
    await expect(service.handle(TOKEN, body)).rejects.toMatchObject({
      code: 'gateway_unavailable',
    });
    expect(invoices.transition).not.toHaveBeenCalled();
  });

  it('UT-088 an overdue notice moves the invoice to overdue and notifies once', async () => {
    const { service, invoices, notify } = build({
      gateway: {
        getCharge: jest.fn().mockResolvedValue({
          externalId: 'pay_1',
          status: 'OVERDUE',
          rawStatus: 'OVERDUE',
          valueCents: 19990,
          dueDate: '2026-11-20',
          paymentDate: null,
        }),
      },
    });
    await service.handle(TOKEN, body);
    expect(invoices.transition).toHaveBeenCalledWith(
      'inv-1',
      [InvoiceStatus.PENDING],
      expect.objectContaining({ status: InvoiceStatus.OVERDUE }),
    );
    expect(notify.notifyOverdue).toHaveBeenCalledTimes(1);
  });
});
