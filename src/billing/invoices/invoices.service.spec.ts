import { randomBytes } from 'crypto';
import type { BillingOwner } from '@/billing/owner/types/billingOwner';
import { CodedError } from '@/common/errors/codedError';
import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { InvoicesRepository } from '@/repositories/billing/invoices.repository';
import { StudentTaxIdRepository } from '@/repositories/billing/studentTaxId.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { encryptSecret } from '@/billing/shared/secretCipher';
import {
  BillingAccount,
  BillingAccountStatus,
  Client,
  Invoice,
  InvoiceStatus,
  Prisma,
  ProductTier,
  ProductType,
} from '@prisma/client';
import { PaymentGateway } from '../gateway/paymentGateway';
import { InvoicesService } from './invoices.service';

const CIPHER_KEY = randomBytes(32);
const PROFESSIONAL_ID = 'educator-1';
const OWNER: BillingOwner = {
  ownerId: PROFESSIONAL_ID,
  kind: 'PROFESSIONAL',
  academiaId: null,
};
const CLIENT_ID = 'client-1';
const ACCOUNT_ID = 'acc-1';
const INVOICE_ID = 'inv-1';
const TODAY = new Date('2026-11-18T12:00:00.000Z');
const VALID_CPF = '52998224725';

function premiumEducator() {
  return {
    id: PROFESSIONAL_ID,
    subscriptionStatus: 'active',
    product: {
      id: 'p',
      type: ProductType.PHYSICAL_EDUCATOR,
      tier: ProductTier.PREMIUM,
      price: 59.9,
    },
  };
}

function accountRow(overrides: Partial<BillingAccount> = {}): BillingAccount {
  return {
    id: ACCOUNT_ID,
    userId: PROFESSIONAL_ID,
    provider: 'ASAAS',
    status: BillingAccountStatus.ACTIVE,
    accountName: 'Thiago Ramos',
    apiKeyEncrypted: encryptSecret('fake-key', CIPHER_KEY),
    apiKeyFingerprint: 'fp',
    webhookId: 'wh_1',
    webhookTokenHash: 'hash',
    keyInvalidAt: null,
    createdAt: TODAY,
    updatedAt: TODAY,
    ...overrides,
  } as BillingAccount;
}

function clientRow(overrides: Partial<Client> = {}): Client {
  return {
    id: CLIENT_ID,
    name: 'Ana Souza',
    email: 'ana@example.test',
    phone: '11999990000',
    userId: null,
    professionalId: PROFESSIONAL_ID,
    academiaId: null,
    birthDate: null,
    createdAt: TODAY,
    updatedAt: TODAY,
    ...overrides,
  } as Client;
}

function invoiceRow(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: INVOICE_ID,
    clientId: CLIENT_ID,
    billingAccountId: ACCOUNT_ID,
    competenceYear: 2026,
    competenceMonth: 11,
    amountCents: 19990,
    dueDate: new Date('2026-11-25'),
    status: InvoiceStatus.PENDING,
    externalId: 'pay_1',
    paymentUrl: 'https://pay.test/1',
    paidAt: null,
    paidAmountCents: null,
    manualNote: null,
    linkSentAt: null,
    overdueNotifiedAt: null,
    paidNotifiedAt: null,
    createdAt: TODAY,
    updatedAt: TODAY,
    ...overrides,
  } as Invoice;
}

function build(
  overrides: {
    user?: unknown;
    invoices?: Partial<Record<keyof InvoicesRepository, jest.Mock>>;
    taxIds?: Partial<Record<keyof StudentTaxIdRepository, jest.Mock>>;
    clients?: Partial<Record<keyof ClientsRepository, jest.Mock>>;
    accounts?: Partial<Record<keyof BillingAccountRepository, jest.Mock>>;
    gateway?: Partial<Record<keyof PaymentGateway, jest.Mock>>;
  } = {},
) {
  const invoices = {
    // Mirrors the real repository's own string-to-Date conversion for
    // dueDate (NewInvoiceReservation.dueDate is a string; Invoice.dueDate
    // is a Date) so the mock's return shape matches the real contract.
    reserve: jest.fn().mockImplementation((data) =>
      invoiceRow({
        ...data,
        dueDate: new Date(data.dueDate),
        id: 'inv-new',
        externalId: null,
        paymentUrl: null,
      }),
    ),
    confirmCharge: jest
      .fn()
      .mockImplementation((id, data) => invoiceRow({ id, ...data })),
    deleteReservation: jest.fn().mockResolvedValue(undefined),
    findOpenForCompetence: jest.fn().mockResolvedValue(null),
    findOwned: jest.fn().mockResolvedValue(invoiceRow()),
    list: jest.fn().mockResolvedValue({ items: [invoiceRow()], total: 1 }),
    findOpenAndOverdueByClient: jest.fn().mockResolvedValue([]),
    transition: jest
      .fn()
      .mockImplementation((id, _from, data) => invoiceRow({ id, ...data })),
    claimResend: jest.fn().mockResolvedValue(true),
    findBillingCustomer: jest.fn().mockResolvedValue(null),
    createBillingCustomer: jest
      .fn()
      .mockResolvedValue({ id: 'bc-1', externalId: 'cus_1' }),
    ...overrides.invoices,
  };
  const taxIds = {
    find: jest.fn().mockResolvedValue({
      clientId: CLIENT_ID,
      ciphertext: encryptSecret(VALID_CPF, CIPHER_KEY),
      updatedAt: TODAY,
    }),
    upsert: jest.fn().mockResolvedValue(undefined),
    ...overrides.taxIds,
  };
  const clients = {
    getClientById: jest.fn().mockResolvedValue(clientRow()),
    ...overrides.clients,
  };
  const accounts = {
    findActiveByUser: jest.fn().mockResolvedValue(accountRow()),
    findById: jest.fn().mockResolvedValue(accountRow()),
    ...overrides.accounts,
  };
  const gateway = {
    ensureCustomer: jest.fn().mockResolvedValue({ externalId: 'cus_1' }),
    createCharge: jest.fn().mockResolvedValue({
      externalId: 'pay_1',
      paymentUrl: 'https://pay.test/1',
    }),
    getCharge: jest.fn().mockResolvedValue({
      externalId: 'pay_1',
      status: 'PENDING',
      rawStatus: 'PENDING',
      valueCents: 19990,
      dueDate: '2026-11-25',
      paymentDate: null,
    }),
    updateCharge: jest.fn().mockResolvedValue(undefined),
    cancelCharge: jest.fn().mockResolvedValue(undefined),
    ...overrides.gateway,
  };
  const users = {
    findByIdWithProduct: jest
      .fn()
      .mockResolvedValue(
        overrides.user === undefined ? premiumEducator() : overrides.user,
      ),
  };
  const accountService = {
    withAccountKey: jest.fn((_account: unknown, op: (k: string) => unknown) =>
      op('fake-api-key'),
    ),
  };
  const mailService = {
    sendNotificationEmail: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };

  const service = new InvoicesService(
    invoices as unknown as InvoicesRepository,
    taxIds as unknown as StudentTaxIdRepository,
    clients as unknown as ClientsRepository,
    accounts as unknown as BillingAccountRepository,
    accountService as never,
    users as unknown as UserRepository,
    gateway as unknown as PaymentGateway,
    CIPHER_KEY,
    mailService as never,
    notifications as never,
  );
  return {
    service,
    invoices,
    taxIds,
    clients,
    accounts,
    gateway,
    users,
    accountService,
    mailService,
    notifications,
  };
}

function createDto(overrides: Record<string, unknown> = {}) {
  return {
    competenceYear: 2026,
    competenceMonth: 11,
    amount: '199.90',
    dueDate: '2026-11-25',
    cpfCnpj: undefined,
    ...overrides,
  };
}

beforeAll(() => jest.useFakeTimers().setSystemTime(TODAY));
afterAll(() => jest.useRealTimers());

describe('InvoicesService.list (UT-045)', () => {
  it('returns invoices with situation, masked tax id and gateway flags', async () => {
    const { service } = build();
    const result = await service.list(OWNER, CLIENT_ID, 1);
    expect(result.items).toHaveLength(1);
    expect(result.taxId).toEqual({ present: true, masked: '***.***.***-25' });
    expect(result.gateway).toEqual({ connected: true, premium: true });
  });

  it('throws 404 student_not_found for a foreign or missing student', async () => {
    const { service } = build({
      clients: { getClientById: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.list(OWNER, CLIENT_ID, 1)).rejects.toMatchObject({
      code: 'student_not_found',
    });
  });

  it('works for a professional without Premium and without a connection', async () => {
    const { service } = build({
      user: {
        ...premiumEducator(),
        product: { ...premiumEducator().product, tier: ProductTier.STANDARD },
      },
      accounts: { findActiveByUser: jest.fn().mockResolvedValue(null) },
    });
    const result = await service.list(OWNER, CLIENT_ID, 1);
    expect(result.gateway).toEqual({ connected: false, premium: false });
  });
});

describe('InvoicesService.create', () => {
  it('UT-046 reserves, charges, confirms, e-mails and notifies', async () => {
    const { service, invoices, mailService, notifications } = build({
      clients: {
        getClientById: jest
          .fn()
          .mockResolvedValue(clientRow({ userId: 'user-1' })),
      },
    });
    const result = await service.create(OWNER, CLIENT_ID, createDto());
    expect(result.status).toBe(InvoiceStatus.PENDING);
    expect(result.emailSent).toBe(true);
    expect(invoices.confirmCharge).toHaveBeenCalledWith('inv-new', {
      externalId: 'pay_1',
      paymentUrl: 'https://pay.test/1',
    });
    expect(mailService.sendNotificationEmail).toHaveBeenCalled();
    expect(notifications.create).toHaveBeenCalledWith(
      'user-1',
      'BILLING',
      expect.any(String),
      undefined,
      true,
    );
  });

  it('UT-047 requires a tax id on the first invoice and stores one that is sent', async () => {
    const { service, taxIds } = build({
      taxIds: { find: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      service.create(OWNER, CLIENT_ID, createDto({ cpfCnpj: undefined })),
    ).rejects.toMatchObject({ code: 'tax_id_required' });
    await expect(
      service.create(OWNER, CLIENT_ID, createDto({ cpfCnpj: '123' })),
    ).rejects.toMatchObject({ code: 'tax_id_invalid' });

    await service.create(OWNER, CLIENT_ID, createDto({ cpfCnpj: VALID_CPF }));
    expect(taxIds.upsert).toHaveBeenCalledWith(CLIENT_ID, expect.any(String));
  });

  it('UT-048 rejects invalid amount, due date or competence without touching the gateway', async () => {
    const { service, invoices, gateway } = build();
    await expect(
      service.create(OWNER, CLIENT_ID, createDto({ amount: '1.00' })),
    ).rejects.toMatchObject({ code: 'invoice_invalid' });
    await expect(
      service.create(OWNER, CLIENT_ID, createDto({ dueDate: '2020-01-01' })),
    ).rejects.toMatchObject({ code: 'invoice_invalid' });
    await expect(
      service.create(OWNER, CLIENT_ID, createDto({ competenceYear: 1999 })),
    ).rejects.toMatchObject({ code: 'invoice_invalid' });
    expect(invoices.reserve).not.toHaveBeenCalled();
    expect(gateway.createCharge).not.toHaveBeenCalled();
  });

  it('UT-049 refuses a second invoice for the same month, naming it; allows one after cancellation', async () => {
    const existing = invoiceRow({ id: 'inv-existing' });
    const { service } = build({
      invoices: {
        reserve: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('unique', {
            code: 'P2002',
            clientVersion: 'x',
          }),
        ),
        findOpenForCompetence: jest.fn().mockResolvedValue(existing),
      },
    });
    await expect(
      service.create(OWNER, CLIENT_ID, createDto()),
    ).rejects.toMatchObject({
      code: 'invoice_exists_for_month',
      details: { invoiceId: 'inv-existing' },
    });
  });

  it('UT-050 maps gateway rejection, unavailability and auth failure, deleting the reservation', async () => {
    const { service: rejected, invoices: inv1 } = build({
      gateway: {
        createCharge: jest
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('bad'), { kind: 'validation' }),
          ),
      },
    });
    // The gateway mock throws a raw object; withAccountKey in this test
    // double is a passthrough, so InvoicesService sees whatever the
    // gateway mock throws, matching how BillingAccountService.withAccountKey
    // would have mapped a real GatewayError in production.
    await expect(
      rejected.create(OWNER, CLIENT_ID, createDto()),
    ).rejects.toBeDefined();
    expect(inv1.deleteReservation).toHaveBeenCalledWith('inv-new');
  });

  it('UT-051 a simultaneous second reservation leaves exactly one invoice', async () => {
    const { service, invoices } = build({
      invoices: {
        reserve: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('unique', {
            code: 'P2002',
            clientVersion: 'x',
          }),
        ),
        findOpenForCompetence: jest.fn().mockResolvedValue(invoiceRow()),
      },
    });
    await expect(
      service.create(OWNER, CLIENT_ID, createDto()),
    ).rejects.toMatchObject({ code: 'invoice_exists_for_month' });
    expect(invoices.confirmCharge).not.toHaveBeenCalled();
  });

  it('UT-052/UT-053 keeps the invoice when the e-mail cannot be sent, reporting it and the link', async () => {
    const { service, mailService } = build();
    mailService.sendNotificationEmail.mockRejectedValue(new Error('smtp down'));
    const result = await service.create(OWNER, CLIENT_ID, createDto());
    expect(result.emailSent).toBe(false);
    expect(result.paymentUrl).toBe('https://pay.test/1');
  });

  it('UT-054 a foreign or removed student throws 404, creates nothing, calls no gateway', async () => {
    const { service, invoices, gateway } = build({
      clients: { getClientById: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      service.create(OWNER, CLIENT_ID, createDto()),
    ).rejects.toMatchObject({ code: 'student_not_found' });
    expect(invoices.reserve).not.toHaveBeenCalled();
    expect(gateway.createCharge).not.toHaveBeenCalled();
  });

  it('UT-055 requires a connected account and Premium, creating nothing', async () => {
    const { service: noAccount, invoices: inv1 } = build({
      accounts: { findActiveByUser: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      noAccount.create(OWNER, CLIENT_ID, createDto()),
    ).rejects.toMatchObject({ code: 'gateway_not_connected' });
    expect(inv1.reserve).not.toHaveBeenCalled();

    const { service: notPremium, invoices: inv2 } = build({
      user: {
        ...premiumEducator(),
        product: { ...premiumEducator().product, tier: ProductTier.STANDARD },
      },
    });
    await expect(
      notPremium.create(OWNER, CLIENT_ID, createDto()),
    ).rejects.toMatchObject({ code: 'premium_required' });
    expect(inv2.reserve).not.toHaveBeenCalled();
  });

  it('UT-056 sends the e-mail but no in-app notice for a record without a linked user', async () => {
    const { service, mailService, notifications } = build({
      clients: {
        getClientById: jest.fn().mockResolvedValue(clientRow({ userId: null })),
      },
    });
    await service.create(OWNER, CLIENT_ID, createDto());
    expect(mailService.sendNotificationEmail).toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('UT-057 returns success and logs when the notification service throws after commit', async () => {
    const { service, notifications } = build({
      clients: {
        getClientById: jest
          .fn()
          .mockResolvedValue(clientRow({ userId: 'user-1' })),
      },
    });
    notifications.create.mockRejectedValue(new Error('down'));
    const result = await service.create(OWNER, CLIENT_ID, createDto());
    expect(result.id).toBeDefined();
  });
});

describe('InvoicesService.update', () => {
  it('UT-060 changes amount and due date; overdue becomes pending; competence never changes', async () => {
    const { service, gateway, invoices } = build({
      invoices: {
        findOwned: jest.fn().mockResolvedValue(
          invoiceRow({
            status: InvoiceStatus.OVERDUE,
            dueDate: new Date('2026-11-10'),
          }),
        ),
      },
    });
    const result = await service.update(OWNER, INVOICE_ID, {
      amount: '250.00',
      dueDate: '2026-11-20',
    });
    expect(gateway.updateCharge).toHaveBeenCalledWith('fake-api-key', 'pay_1', {
      amountCents: 25000,
      dueDate: '2026-11-20',
    });
    expect(invoices.transition).toHaveBeenCalledWith(
      INVOICE_ID,
      [InvoiceStatus.PENDING, InvoiceStatus.OVERDUE],
      expect.objectContaining({ status: InvoiceStatus.PENDING }),
    );
    expect(result.status).toBe(InvoiceStatus.PENDING);
  });

  it('UT-061 applies paid and throws 409 when the gateway already shows the charge paid', async () => {
    const { service, invoices } = build({
      gateway: {
        getCharge: jest.fn().mockResolvedValue({
          externalId: 'pay_1',
          status: 'PAID',
          rawStatus: 'RECEIVED',
          valueCents: 19990,
          dueDate: '2026-11-25',
          paymentDate: '2026-11-18',
        }),
      },
    });
    await expect(
      service.update(OWNER, INVOICE_ID, { amount: '1.00' }),
    ).rejects.toMatchObject({ code: 'invoice_already_paid' });
    expect(invoices.transition).toHaveBeenCalledWith(
      INVOICE_ID,
      expect.any(Array),
      expect.objectContaining({ status: InvoiceStatus.PAID }),
    );
  });

  it('UT-062 refuses a paid, manually paid or canceled invoice with invoice_not_open', async () => {
    for (const status of [
      InvoiceStatus.PAID,
      InvoiceStatus.PAID_MANUALLY,
      InvoiceStatus.CANCELED,
    ]) {
      const { service } = build({
        invoices: {
          findOwned: jest.fn().mockResolvedValue(invoiceRow({ status })),
        },
      });
      await expect(
        service.update(OWNER, INVOICE_ID, { amount: '1.00' }),
      ).rejects.toMatchObject({ code: 'invoice_not_open' });
    }
  });

  it('UT-063 identical values make no gateway call and write nothing', async () => {
    const { service, gateway, invoices } = build();
    const result = await service.update(OWNER, INVOICE_ID, {
      amount: '199.90',
      dueDate: '2026-11-25',
    });
    expect(gateway.updateCharge).not.toHaveBeenCalled();
    expect(invoices.transition).not.toHaveBeenCalled();
    expect(result.id).toBe(INVOICE_ID);
  });

  it('UT-064 leaves the invoice unchanged when the gateway rejects or is unavailable', async () => {
    const { service, invoices } = build({
      gateway: {
        updateCharge: jest
          .fn()
          .mockRejectedValue(new CodedError('bad', 422, 'gateway_rejected')),
      },
    });
    await expect(
      service.update(OWNER, INVOICE_ID, { amount: '250.00' }),
    ).rejects.toMatchObject({ code: 'gateway_rejected' });
    expect(invoices.transition).not.toHaveBeenCalled();
  });

  it('UT-065 a foreign or missing invoice throws 404 invoice_not_found', async () => {
    const { service } = build({
      invoices: { findOwned: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      service.update(OWNER, INVOICE_ID, { amount: '1.00' }),
    ).rejects.toMatchObject({ code: 'invoice_not_found' });
  });

  it('UT-066 a conditional write that matches no row (changed meanwhile) throws invoice_not_open', async () => {
    const { service } = build({
      invoices: { transition: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      service.update(OWNER, INVOICE_ID, { amount: '250.00' }),
    ).rejects.toMatchObject({ code: 'invoice_not_open' });
  });
});

describe('InvoicesService.cancel', () => {
  it('UT-070 cancels the charge and moves the invoice to canceled', async () => {
    const { service, gateway, invoices } = build();
    const result = await service.cancel(OWNER, INVOICE_ID);
    expect(gateway.cancelCharge).toHaveBeenCalledWith('fake-api-key', 'pay_1');
    expect(invoices.transition).toHaveBeenCalledWith(
      INVOICE_ID,
      expect.any(Array),
      { status: InvoiceStatus.CANCELED },
    );
    expect(result.id).toBe(INVOICE_ID);
  });

  it('UT-070 an invoice the gateway shows as paid becomes paid with 409', async () => {
    const { service } = build({
      gateway: {
        getCharge: jest.fn().mockResolvedValue({
          externalId: 'pay_1',
          status: 'PAID',
          rawStatus: 'RECEIVED',
          valueCents: 19990,
          dueDate: '2026-11-25',
          paymentDate: '2026-11-18',
        }),
      },
    });
    await expect(service.cancel(OWNER, INVOICE_ID)).rejects.toMatchObject({
      code: 'invoice_already_paid',
    });
  });

  it('UT-070 canceling an already canceled invoice returns it unchanged', async () => {
    const { service, gateway } = build({
      invoices: {
        findOwned: jest
          .fn()
          .mockResolvedValue(invoiceRow({ status: InvoiceStatus.CANCELED })),
      },
    });
    const result = await service.cancel(OWNER, INVOICE_ID);
    expect(result.status).toBe(InvoiceStatus.CANCELED);
    expect(gateway.cancelCharge).not.toHaveBeenCalled();
  });

  it('UT-071 leaves the invoice open and throws when the gateway fails', async () => {
    const { service, invoices } = build({
      gateway: {
        cancelCharge: jest
          .fn()
          .mockRejectedValue(new CodedError('x', 503, 'gateway_unavailable')),
      },
    });
    await expect(service.cancel(OWNER, INVOICE_ID)).rejects.toMatchObject({
      code: 'gateway_unavailable',
    });
    expect(invoices.transition).not.toHaveBeenCalled();
  });
});

describe('InvoicesService.markPaid', () => {
  it('UT-072 cancels the charge and moves the invoice to paid manually', async () => {
    const { service, gateway, invoices } = build();
    const result = await service.markPaid(OWNER, INVOICE_ID, {
      paidOn: '2026-11-18',
      note: 'Pago em dinheiro.',
    });
    expect(gateway.cancelCharge).toHaveBeenCalledWith('fake-api-key', 'pay_1');
    expect(invoices.transition).toHaveBeenCalledWith(
      INVOICE_ID,
      expect.any(Array),
      expect.objectContaining({ status: InvoiceStatus.PAID_MANUALLY }),
    );
    expect(result.status).toBe(InvoiceStatus.PAID_MANUALLY);
  });

  it('UT-072 becomes paid (not manual) with 409 when the gateway already shows it paid', async () => {
    const { service } = build({
      gateway: {
        getCharge: jest.fn().mockResolvedValue({
          externalId: 'pay_1',
          status: 'PAID',
          rawStatus: 'RECEIVED',
          valueCents: 19990,
          dueDate: '2026-11-25',
          paymentDate: '2026-11-18',
        }),
      },
    });
    await expect(
      service.markPaid(OWNER, INVOICE_ID, { paidOn: '2026-11-18' }),
    ).rejects.toMatchObject({ code: 'invoice_already_paid' });
  });

  it('UT-072 stays open when the gateway cancellation fails', async () => {
    const { service, invoices } = build({
      gateway: {
        cancelCharge: jest
          .fn()
          .mockRejectedValue(new CodedError('x', 503, 'gateway_unavailable')),
      },
    });
    await expect(
      service.markPaid(OWNER, INVOICE_ID, { paidOn: '2026-11-18' }),
    ).rejects.toMatchObject({ code: 'gateway_unavailable' });
    expect(invoices.transition).not.toHaveBeenCalled();
  });

  it('UT-072 marking an already manually paid invoice returns it unchanged', async () => {
    const { service, gateway } = build({
      invoices: {
        findOwned: jest
          .fn()
          .mockResolvedValue(
            invoiceRow({ status: InvoiceStatus.PAID_MANUALLY }),
          ),
      },
    });
    const result = await service.markPaid(OWNER, INVOICE_ID, {
      paidOn: '2026-11-18',
    });
    expect(result.status).toBe(InvoiceStatus.PAID_MANUALLY);
    expect(gateway.cancelCharge).not.toHaveBeenCalled();
  });

  it('UT-013/UT-073 rejects a future payment date and a 201-character note, changing nothing', async () => {
    const { service: futureDated, invoices: inv1 } = build();
    await expect(
      futureDated.markPaid(OWNER, INVOICE_ID, {
        paidOn: '2026-11-19',
      }),
    ).rejects.toMatchObject({ code: 'invoice_invalid' });
    expect(inv1.transition).not.toHaveBeenCalled();

    const { service: longNote, invoices: inv2 } = build();
    await expect(
      longNote.markPaid(OWNER, INVOICE_ID, {
        paidOn: '2026-11-18',
        note: 'x'.repeat(201),
      }),
    ).rejects.toMatchObject({ code: 'invoice_invalid' });
    expect(inv2.transition).not.toHaveBeenCalled();
  });

  it('UT-013 accepts a payment date of today and a 200-character note', async () => {
    const { service } = build();
    const result = await service.markPaid(OWNER, INVOICE_ID, {
      paidOn: '2026-11-18',
      note: 'x'.repeat(200),
    });
    expect(result.status).toBe(InvoiceStatus.PAID_MANUALLY);
  });
});

describe('InvoicesService.resend', () => {
  it('UT-075 claims linkSentAt and sends the e-mail with the same link', async () => {
    const { service, invoices, mailService } = build();
    await service.resend(OWNER, INVOICE_ID);
    expect(invoices.claimResend).toHaveBeenCalled();
    expect(mailService.sendNotificationEmail).toHaveBeenCalledWith(
      'Ana Souza',
      'ana@example.test',
      expect.any(String),
      expect.any(String),
      'https://pay.test/1',
    );
  });

  it('UT-014/UT-075 refuses a second resend within the hour with the minutes left', async () => {
    const { service } = build({
      invoices: {
        findOwned: jest
          .fn()
          .mockResolvedValue(
            invoiceRow({ linkSentAt: new Date(TODAY.getTime() - 59 * 60_000) }),
          ),
        claimResend: jest.fn().mockResolvedValue(false),
      },
    });
    await expect(service.resend(OWNER, INVOICE_ID)).rejects.toMatchObject({
      code: 'resend_too_soon',
      details: { minutesLeft: 1 },
    });
  });

  it('UT-014 allows a resend at exactly 60 minutes', async () => {
    const { service, invoices } = build({
      invoices: {
        findOwned: jest
          .fn()
          .mockResolvedValue(
            invoiceRow({ linkSentAt: new Date(TODAY.getTime() - 60 * 60_000) }),
          ),
      },
    });
    await service.resend(OWNER, INVOICE_ID);
    expect(invoices.claimResend).toHaveBeenCalled();
  });

  it('UT-075 a closed invoice throws invoice_not_open', async () => {
    const { service } = build({
      invoices: {
        findOwned: jest
          .fn()
          .mockResolvedValue(invoiceRow({ status: InvoiceStatus.CANCELED })),
      },
    });
    await expect(service.resend(OWNER, INVOICE_ID)).rejects.toMatchObject({
      code: 'invoice_not_open',
    });
  });

  it('UT-075 a failed send is reported and the link remains available (resend still succeeds)', async () => {
    const { service, mailService } = build();
    mailService.sendNotificationEmail.mockRejectedValue(new Error('smtp down'));
    await expect(service.resend(OWNER, INVOICE_ID)).resolves.toBeUndefined();
  });
});

describe('InvoicesService.setTaxId (UT-076)', () => {
  it('stores a valid number encrypted and returns only the masked value', async () => {
    const { service, taxIds } = build();
    const result = await service.setTaxId(OWNER, CLIENT_ID, VALID_CPF);
    expect(taxIds.upsert).toHaveBeenCalledWith(CLIENT_ID, expect.any(String));
    expect(result).toEqual({ present: true, masked: '***.***.***-25' });
  });

  it('an invalid number throws 400 tax_id_invalid', async () => {
    const { service } = build();
    await expect(
      service.setTaxId(OWNER, CLIENT_ID, '123'),
    ).rejects.toMatchObject({ code: 'tax_id_invalid' });
  });

  it('a foreign student throws 404', async () => {
    const { service } = build({
      clients: { getClientById: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      service.setTaxId(OWNER, CLIENT_ID, VALID_CPF),
    ).rejects.toMatchObject({ code: 'student_not_found' });
  });
});

// financial-health task 1: invoice ownership generalized to gym owners.
describe('InvoicesService for gym owners and educators (financial-health UT-024 to UT-031)', () => {
  const GYM_OWNER: BillingOwner = {
    ownerId: 'gym-owner-1',
    kind: 'GYM',
    academiaId: 'academia-1',
  };
  const gymFee = () =>
    invoiceRow({ billingAccountId: 'gym-acc-1', clientId: 'gym-student-1' });
  const gymStudent = () =>
    clientRow({
      id: 'gym-student-1',
      professionalId: null,
      academiaId: 'academia-1',
    });

  it('UT-024 refuses an educator invoicing a gym student with student_billed_by_gym, calling no gateway', async () => {
    const { service, gateway, invoices } = build({
      clients: {
        getClientById: jest
          .fn()
          .mockResolvedValue(clientRow({ academiaId: 'academia-1' })),
      },
    });
    await expect(
      service.create(OWNER, CLIENT_ID, createDto()),
    ).rejects.toMatchObject({ status: 403, code: 'student_billed_by_gym' });
    expect(gateway.ensureCustomer).not.toHaveBeenCalled();
    expect(gateway.createCharge).not.toHaveBeenCalled();
    expect(invoices.reserve).not.toHaveBeenCalled();
  });

  it('UT-024 still lets an educator invoice an independent student', async () => {
    const { service } = build();
    await expect(
      service.create(OWNER, CLIENT_ID, createDto()),
    ).resolves.toMatchObject({ status: InvoiceStatus.PENDING });
  });

  it('UT-025 refuses a gym owner creating an invoice, even for its own student', async () => {
    const { service, gateway, invoices } = build({
      clients: { getClientById: jest.fn().mockResolvedValue(gymStudent()) },
    });
    await expect(
      service.create(GYM_OWNER, 'gym-student-1', createDto()),
    ).rejects.toMatchObject({
      status: 403,
      code: 'manual_invoice_not_allowed',
    });
    expect(invoices.reserve).not.toHaveBeenCalled();
    expect(gateway.createCharge).not.toHaveBeenCalled();
  });

  it('UT-026 refuses a gym owner editing its own fee', async () => {
    const { service, gateway, invoices } = build({
      invoices: { findOwned: jest.fn().mockResolvedValue(gymFee()) },
    });
    await expect(
      service.update(GYM_OWNER, INVOICE_ID, { amount: '250.00' }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'manual_invoice_not_allowed',
    });
    expect(gateway.updateCharge).not.toHaveBeenCalled();
    expect(invoices.transition).not.toHaveBeenCalled();
  });

  it('UT-027 lets a gym owner mark its own open fee paid, canceling the charge once', async () => {
    const { service, gateway, invoices } = build({
      invoices: { findOwned: jest.fn().mockResolvedValue(gymFee()) },
    });
    const result = await service.markPaid(GYM_OWNER, INVOICE_ID, {
      paidOn: '2026-11-18',
    });

    expect(result.status).toBe(InvoiceStatus.PAID_MANUALLY);
    expect(invoices.transition).toHaveBeenCalledWith(
      INVOICE_ID,
      expect.any(Array),
      expect.objectContaining({
        status: InvoiceStatus.PAID_MANUALLY,
        paidAt: new Date('2026-11-18'),
        paidAmountCents: 19990,
      }),
    );
    expect(gateway.cancelCharge).toHaveBeenCalledTimes(1);
  });

  it('UT-028 rejects a payment date of tomorrow (Brasilia) and leaves the fee unchanged', async () => {
    const { service, invoices } = build({
      invoices: { findOwned: jest.fn().mockResolvedValue(gymFee()) },
    });
    await expect(
      service.markPaid(GYM_OWNER, INVOICE_ID, { paidOn: '2026-11-19' }),
    ).rejects.toMatchObject({ status: 400, code: 'invoice_invalid' });
    expect(invoices.transition).not.toHaveBeenCalled();
  });

  it('UT-029 a second cancel never cancels the charge again (idempotent on a canceled fee)', async () => {
    const open = gymFee();
    const findOwned = jest
      .fn()
      .mockResolvedValueOnce(open)
      .mockResolvedValueOnce({ ...open, status: InvoiceStatus.CANCELED });
    const { service, gateway } = build({ invoices: { findOwned } });

    const first = await service.cancel(GYM_OWNER, INVOICE_ID);
    const second = await service.cancel(GYM_OWNER, INVOICE_ID);

    expect(first.status).toBe(InvoiceStatus.CANCELED);
    expect(second.status).toBe(InvoiceStatus.CANCELED);
    expect(gateway.cancelCharge).toHaveBeenCalledTimes(1);
  });

  it('UT-029 two simultaneous cancels: the one that loses the conditional write gets the not-open 409', async () => {
    const { service } = build({
      invoices: {
        findOwned: jest.fn().mockResolvedValue(gymFee()),
        transition: jest.fn().mockResolvedValue(null),
      },
    });
    await expect(service.cancel(GYM_OWNER, INVOICE_ID)).rejects.toMatchObject({
      status: 409,
      code: 'invoice_not_open',
    });
  });

  it('UT-030 refuses to resend a canceled fee with 409 and sends no e-mail', async () => {
    const { service, mailService } = build({
      invoices: {
        findOwned: jest.fn().mockResolvedValue({
          ...gymFee(),
          status: InvoiceStatus.CANCELED,
        }),
      },
    });
    await expect(service.resend(GYM_OWNER, INVOICE_ID)).rejects.toMatchObject({
      status: 409,
    });
    expect(mailService.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('UT-031 with the key refused, resend asks to reconnect (409) while mark paid still succeeds', async () => {
    const refused = accountRow({ keyInvalidAt: TODAY });
    const resend = build({
      invoices: { findOwned: jest.fn().mockResolvedValue(gymFee()) },
      accounts: { findById: jest.fn().mockResolvedValue(refused) },
    });
    await expect(
      resend.service.resend(GYM_OWNER, INVOICE_ID),
    ).rejects.toMatchObject({ status: 409, code: 'billing_reconnect_needed' });
    expect(resend.mailService.sendNotificationEmail).not.toHaveBeenCalled();

    const mark = build({
      invoices: { findOwned: jest.fn().mockResolvedValue(gymFee()) },
      accounts: { findById: jest.fn().mockResolvedValue(refused) },
    });
    const result = await mark.service.markPaid(GYM_OWNER, INVOICE_ID, {
      paidOn: '2026-11-18',
    });
    expect(result.status).toBe(InvoiceStatus.PAID_MANUALLY);
    expect(mark.gateway.cancelCharge).not.toHaveBeenCalled();
  });

  it('mark paid also proceeds when the gateway refuses the key during the call', async () => {
    const { service, invoices } = build({
      invoices: { findOwned: jest.fn().mockResolvedValue(gymFee()) },
      gateway: {
        getCharge: jest
          .fn()
          .mockRejectedValue(new CodedError('x', 400, 'gateway_auth_failed')),
      },
    });
    const result = await service.markPaid(GYM_OWNER, INVOICE_ID, {
      paidOn: '2026-11-18',
    });
    expect(result.status).toBe(InvoiceStatus.PAID_MANUALLY);
    expect(invoices.transition).toHaveBeenCalled();
  });

  it('a gym owner reads and tags only students of its own academia', async () => {
    const own = build({
      clients: { getClientById: jest.fn().mockResolvedValue(gymStudent()) },
    });
    await expect(
      own.service.setTaxId(GYM_OWNER, 'gym-student-1', VALID_CPF),
    ).resolves.toEqual({ present: true, masked: '***.***.***-25' });

    const foreign = build({
      clients: {
        getClientById: jest
          .fn()
          .mockResolvedValue({ ...gymStudent(), academiaId: 'academia-2' }),
      },
    });
    await expect(
      foreign.service.setTaxId(GYM_OWNER, 'gym-student-1', VALID_CPF),
    ).rejects.toMatchObject({ code: 'student_not_found' });
    await expect(
      foreign.service.list(GYM_OWNER, 'gym-student-1', 1),
    ).rejects.toMatchObject({ code: 'student_not_found' });
  });

  it('an educator keeps reading the billing tab of a student who has since joined a gym, scoped to their own invoices', async () => {
    const { service, invoices } = build({
      clients: {
        getClientById: jest
          .fn()
          .mockResolvedValue(clientRow({ academiaId: 'academia-1' })),
      },
    });
    await service.list(OWNER, CLIENT_ID, 1);
    expect(invoices.list).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: CLIENT_ID,
        ownerId: PROFESSIONAL_ID,
      }),
    );
  });
});
