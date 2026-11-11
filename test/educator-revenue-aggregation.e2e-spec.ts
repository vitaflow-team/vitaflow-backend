/**
 * Real-test-database coverage for `InvoiceRepository.sumAmountByStudentAndMonth`
 * (role-management-dashboards task_03, ADR-006): a Prisma `groupBy` method,
 * so its SQL grouping/scoping correctness is verified against a real
 * database rather than a mocked Prisma client.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { BillingModule } from '@/billing/billing.module';
import { PrismaService } from '@/database/prisma.service';
import { InvoicesRepository } from '@/repositories/billing/invoices.repository';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { BillingAccount, InvoiceStatus, Users } from '@prisma/client';

jest.setTimeout(60_000);

const RUN_TAG = `edu-revenue-${Date.now()}`;

describe('InvoiceRepository.sumAmountByStudentAndMonth (UT-025, UT-026, UT-027, UT-049)', () => {
  let moduleFixture: TestingModule;
  let prisma: PrismaService;
  let invoices: InvoicesRepository;
  let educator: Users;
  let account: BillingAccount;
  const clientIds: string[] = [];
  const academiaIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

    moduleFixture = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), BillingModule],
    }).compile();
    prisma = moduleFixture.get(PrismaService);
    invoices = moduleFixture.get(InvoicesRepository);

    educator = await prisma.users.create({
      data: {
        name: `${RUN_TAG} educator`,
        email: `${RUN_TAG}-educator@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
      },
    });
    account = await prisma.billingAccount.create({
      data: {
        userId: educator.id,
        provider: 'ASAAS',
        accountName: `${RUN_TAG} account`,
        apiKeyFingerprint: `${RUN_TAG}-fingerprint`,
        webhookTokenHash: `${RUN_TAG}-webhook-hash`,
      },
    });
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({
      where: { billingAccountId: account.id },
    });
    await prisma.billingAccount.deleteMany({ where: { userId: educator.id } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.users.deleteMany({ where: { id: educator.id } });
    await prisma.academia.deleteMany({ where: { id: { in: academiaIds } } });
    await prisma.$disconnect();
    await moduleFixture.close();
  });

  async function createClient(name: string): Promise<string> {
    const client = await prisma.client.create({
      data: {
        name,
        phone: '11999990000',
        email: `${RUN_TAG}-${name}-${Math.random().toString(36).slice(2, 7)}@integration.test`,
        professionalId: educator.id,
      },
    });
    clientIds.push(client.id);
    return client.id;
  }

  async function createInvoice(
    clientId: string,
    competenceYear: number,
    competenceMonth: number,
    amountCents: number,
    status: InvoiceStatus,
  ) {
    return await prisma.invoice.create({
      data: {
        clientId,
        billingAccountId: account.id,
        competenceYear,
        competenceMonth,
        amountCents,
        dueDate: new Date(
          `${competenceYear}-${String(competenceMonth).padStart(2, '0')}-10`,
        ),
        status,
      },
    });
  }

  it('UT-025: sums paid invoices per (clientId, year, month), one point per combination', async () => {
    // At most one non-canceled invoice per (clientId, year, month) exists in
    // this domain (Invoice_student_month_not_canceled_key) — "3 invoices for
    // 2 students across 2 months" means 3 distinct combinations, not
    // multiple invoices collapsing into one group.
    const studentA = await createClient('UT025-A');
    const studentB = await createClient('UT025-B');
    await createInvoice(studentA, 2026, 9, 10_000, InvoiceStatus.PAID);
    await createInvoice(studentA, 2026, 10, 7_000, InvoiceStatus.PAID_MANUALLY);
    await createInvoice(studentB, 2026, 9, 3_000, InvoiceStatus.PAID);

    const result = await invoices.sumAmountByStudentAndMonth(account.id);

    expect(result).toEqual(
      expect.arrayContaining([
        { clientId: studentA, year: 2026, month: 9, amountCents: 10_000 },
        { clientId: studentA, year: 2026, month: 10, amountCents: 7_000 },
        { clientId: studentB, year: 2026, month: 9, amountCents: 3_000 },
      ]),
    );
    expect(result).toHaveLength(3);
  });

  it('UT-026: still returns a disconnected student’s historical revenue (scoped by billingAccountId, not current portfolio)', async () => {
    // Disconnection that preserves the Client row (academia employment
    // ending, Client_owner_check still satisfied via academiaId) — the only
    // disconnect shape where historical revenue could still be queried; a
    // private student's removal hard-deletes the Client row (and cascades
    // the Invoice with it), so there is nothing left to retain in that case.
    const academia = await prisma.academia.create({
      data: { name: `${RUN_TAG} UT026 academia` },
    });
    academiaIds.push(academia.id);
    const student = await prisma.client.create({
      data: {
        name: `${RUN_TAG} UT026`,
        phone: '11999990000',
        email: `${RUN_TAG}-UT026-${Math.random().toString(36).slice(2, 7)}@integration.test`,
        professionalId: educator.id,
        academiaId: academia.id,
      },
    });
    clientIds.push(student.id);
    await createInvoice(student.id, 2026, 8, 12_000, InvoiceStatus.PAID);
    await prisma.client.update({
      where: { id: student.id },
      data: { professionalId: null },
    });

    const result = await invoices.sumAmountByStudentAndMonth(account.id);

    expect(result).toContainEqual({
      clientId: student.id,
      year: 2026,
      month: 8,
      amountCents: 12_000,
    });
  });

  it('UT-027: reflects the invoice’s current status, not a stale sum from before a cancellation', async () => {
    const student = await createClient('UT027');
    const invoice = await createInvoice(
      student,
      2026,
      7,
      8_000,
      InvoiceStatus.PAID,
    );

    const before = await invoices.sumAmountByStudentAndMonth(account.id);
    expect(before).toContainEqual({
      clientId: student,
      year: 2026,
      month: 7,
      amountCents: 8_000,
    });

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.CANCELED },
    });

    const after = await invoices.sumAmountByStudentAndMonth(account.id);
    expect(after).not.toContainEqual(
      expect.objectContaining({ clientId: student, year: 2026, month: 7 }),
    );
  });

  it('UT-049: returns an empty array for an unknown/invalid billingAccountId, not a thrown error', async () => {
    await expect(
      invoices.sumAmountByStudentAndMonth(
        '00000000-0000-0000-0000-000000000000',
      ),
    ).resolves.toEqual([]);
    await expect(invoices.sumAmountByStudentAndMonth('')).resolves.toEqual([]);
  });
});
