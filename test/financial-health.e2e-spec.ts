/**
 * Integration and end-to-end tests for PRD `professional-financial-health-
 * dashboard`, task 1: the professional and gym panels (`GET /financial-health/
 * summary|delinquents`) against a real migrated database. Only the gateway,
 * the mail service and the clock are replaced.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { brasiliaDateKey } from '@/billing/shared/dates';
import { BillingAccount, InvoiceStatus, Prisma, Users } from '@prisma/client';
import request from 'supertest';
import { FinancialHealthHarness } from './support/financialHealthHarness';

jest.setTimeout(240_000);

const h = new FinancialHealthHarness(`finhealth-${Date.now()}`);
const TODAY_ISO = '2026-11-17T15:00:00Z'; // 12:00 in Brasília
const S = InvoiceStatus;

function competenceOf(dueDate: string): { year: number; month: number } {
  return {
    year: Number(dueDate.slice(0, 4)),
    month: Number(dueDate.slice(5, 7)),
  };
}

function addDays(key: string, days: number): string {
  return new Date(Date.parse(key) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function realToday(): string {
  return brasiliaDateKey(new Date());
}

async function educatorWithAccount(
  label: string,
): Promise<{ user: Users; account: BillingAccount }> {
  const user = await h.createUser(label, h.products.premiumEducator);
  return { user, account: await h.createAccount(user) };
}

// Seeds one invoice for a (new or given) client; competence follows the due
// date unless stated, so one client can hold several months.
async function invoiceFor(
  account: BillingAccount,
  clientId: string,
  input: {
    amountCents: number;
    dueDate: string;
    status?: InvoiceStatus;
    paidAt?: string;
    paidAmountCents?: number;
    competence?: { year: number; month: number };
    externalId?: string | null;
  },
) {
  return await h.seedInvoice({
    clientId,
    billingAccountId: account.id,
    competence: input.competence ?? competenceOf(input.dueDate),
    amountCents: input.amountCents,
    dueDate: input.dueDate,
    status: input.status,
    paidAt: input.paidAt,
    paidAmountCents: input.paidAmountCents,
    externalId: input.externalId,
  });
}

beforeAll(async () => {
  await h.start();
});

afterAll(async () => {
  await h.stop();
});

beforeEach(() => {
  h.setNow(TODAY_ISO);
  h.sendNotificationEmail.mockClear();
});

describe('Panel figures (IT-001 to IT-011)', () => {
  it('IT-001 expected, received, still owed and the overdue bands follow the seed arithmetic', async () => {
    const { user, account } = await educatorWithAccount('it001');
    const [a, b, x, y, e] = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        h.createClient({ professionalId: user.id, name: `C${n}` }),
      ),
    );
    await invoiceFor(account, a.id, {
      amountCents: 10000,
      dueDate: '2026-11-05',
      status: S.PAID,
      paidAt: '2026-11-05',
    });
    await invoiceFor(account, b.id, {
      amountCents: 20000,
      dueDate: '2026-11-20',
    });
    await invoiceFor(account, x.id, {
      amountCents: 30000,
      dueDate: '2026-11-10',
    });
    await invoiceFor(account, y.id, {
      amountCents: 40000,
      dueDate: '2026-10-30',
      status: S.OVERDUE,
    });
    await invoiceFor(account, e.id, {
      amountCents: 5000,
      dueDate: '2026-11-15',
      status: S.CANCELED,
    });

    const response = await h.summary(user, '2026-11');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      audience: 'PROFESSIONAL',
      billingState: 'CONNECTED',
      hasHistory: true,
      month: '2026-11',
      current: {
        expectedCents: 60000,
        receivedCents: 10000,
        stillOwedCents: 50000,
      },
      overdue: {
        totalCents: 70000,
        delinquentCount: 2,
        bands: { d1to7Cents: 30000, d8to30Cents: 40000, d31PlusCents: 0 },
      },
    });
  });

  it('IT-001 the previous month travels with the summary', async () => {
    const { user, account } = await educatorWithAccount('it001b');
    const c = await h.createClient({ professionalId: user.id });
    await invoiceFor(account, c.id, {
      amountCents: 12000,
      dueDate: '2026-10-12',
      status: S.PAID,
      paidAt: '2026-10-13',
    });

    const response = await h.summary(user, '2026-11');

    expect(response.body.previous).toEqual({
      expectedCents: 12000,
      receivedCents: 12000,
      stillOwedCents: 0,
    });
    expect(response.body.current).toEqual({
      expectedCents: 0,
      receivedCents: 0,
      stillOwedCents: 0,
    });
  });

  it('IT-002 received counts the amount actually paid, in the payment month, whatever the due month', async () => {
    const { user, account } = await educatorWithAccount('it002');
    const [f, g] = await Promise.all(
      [1, 2].map((n) =>
        h.createClient({ professionalId: user.id, name: `P${n}` }),
      ),
    );
    await invoiceFor(account, f.id, {
      amountCents: 24000,
      dueDate: '2026-10-28',
      status: S.PAID,
      paidAt: '2026-11-03',
      paidAmountCents: 25000,
    });
    await invoiceFor(account, g.id, {
      amountCents: 15000,
      dueDate: '2026-11-12',
      status: S.PAID_MANUALLY,
      paidAt: '2026-11-12',
      paidAmountCents: 15000,
    });

    const november = await h.summary(user, '2026-11');
    expect(november.body.current.receivedCents).toBe(40000);
    expect(november.body.current.expectedCents).toBe(15000);

    const october = await h.summary(user, '2026-10');
    expect(october.body.current.expectedCents).toBe(24000);
    expect(october.body.current.receivedCents).toBe(0);
  });

  it('IT-003 unissued reservations and canceled invoices are in no figure', async () => {
    const { user, account } = await educatorWithAccount('it003');
    const [real, reservation, canceled] = await Promise.all(
      [1, 2, 3].map((n) =>
        h.createClient({ professionalId: user.id, name: `R${n}` }),
      ),
    );
    await invoiceFor(account, real.id, {
      amountCents: 10000,
      dueDate: '2026-11-10',
    });
    await invoiceFor(account, reservation.id, {
      amountCents: 70000,
      dueDate: '2026-11-10',
      externalId: null,
    });
    await invoiceFor(account, canceled.id, {
      amountCents: 80000,
      dueDate: '2026-11-10',
      status: S.CANCELED,
    });

    const summary = await h.summary(user, '2026-11');
    const delinquents = await h.delinquents(user);

    expect(summary.body.current).toEqual({
      expectedCents: 10000,
      receivedCents: 0,
      stillOwedCents: 10000,
    });
    expect(summary.body.overdue.totalCents).toBe(10000);
    expect(summary.body.overdue.delinquentCount).toBe(1);
    expect(
      delinquents.body.items.map((i: { clientId: string }) => i.clientId),
    ).toEqual([real.id]);
  });

  it('IT-004 one educator never sees another educator’s data, and crafted parameters are ignored', async () => {
    const one = await educatorWithAccount('it004a');
    const two = await educatorWithAccount('it004b');
    const mine = await h.createClient({
      professionalId: one.user.id,
      name: 'Meu aluno',
    });
    const theirs = await h.createClient({
      professionalId: two.user.id,
      name: 'Aluno alheio',
    });
    await invoiceFor(one.account, mine.id, {
      amountCents: 11000,
      dueDate: '2026-11-01',
    });
    await invoiceFor(two.account, theirs.id, {
      amountCents: 99000,
      dueDate: '2026-11-01',
    });

    const summary = await h.get(
      one.user,
      'get',
      `/financial-health/summary?month=2026-11&ownerId=${two.user.id}&professionalId=${two.user.id}`,
    );
    const list = await h.get(
      one.user,
      'get',
      `/financial-health/delinquents?ownerId=${two.user.id}`,
    );

    expect(summary.body.current.expectedCents).toBe(11000);
    expect(list.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Meu aluno',
    ]);
  });

  it('IT-005 an employed educator’s panel holds their independent students and legacy invoices, never the gym’s fees', async () => {
    const { owner, academiaId } = await h.createGymOwner('it005-gym');
    const gymAccount = await h.createAccount(owner);
    const educator = await educatorWithAccount('it005-edu');
    await h.prisma.employment.create({
      data: { academiaId, educatorId: educator.user.id, status: 'ACTIVE' },
    });

    const independent = await h.createClient({
      professionalId: educator.user.id,
      name: 'Independente',
    });
    const gymStudent = await h.createClient({
      professionalId: educator.user.id,
      academiaId,
      name: 'Aluno da academia',
    });
    await invoiceFor(educator.account, independent.id, {
      amountCents: 10000,
      dueDate: '2026-11-01',
    });
    await invoiceFor(educator.account, gymStudent.id, {
      amountCents: 20000,
      dueDate: '2026-10-01',
    });
    await invoiceFor(gymAccount, gymStudent.id, {
      amountCents: 30000,
      dueDate: '2026-11-05',
    });

    const educatorPanel = await h.delinquents(educator.user);
    const gymPanel = await h.delinquents(owner);
    const educatorSummary = await h.summary(educator.user, '2026-11');
    const gymSummary = await h.summary(owner, '2026-11');

    expect(
      educatorPanel.body.items
        .map((i: { name: string; totalOwedCents: number }) => [
          i.name,
          i.totalOwedCents,
        ])
        .sort(),
    ).toEqual([
      ['Aluno da academia', 20000],
      ['Independente', 10000],
    ]);
    expect(educatorSummary.body.overdue.totalCents).toBe(30000);
    expect(gymPanel.body.items).toHaveLength(1);
    expect(gymPanel.body.items[0]).toMatchObject({
      name: 'Aluno da academia',
      totalOwedCents: 30000,
    });
    expect(gymSummary.body).toMatchObject({
      audience: 'GYM',
      current: { expectedCents: 30000 },
    });

    const before = await h.prisma.invoice.count({
      where: { clientId: gymStudent.id },
    });
    const refused = await h
      .get(educator.user, 'post', `/billing/students/${gymStudent.id}/invoices`)
      .send({
        competenceYear: 2026,
        competenceMonth: 11,
        amount: '100.00',
        dueDate: realToday(),
        cpfCnpj: '529.982.247-25',
      });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('student_billed_by_gym');
    expect(
      await h.prisma.invoice.count({ where: { clientId: gymStudent.id } }),
    ).toBe(before);

    await h.prisma.employment.updateMany({
      where: { educatorId: educator.user.id },
      data: { status: 'ENDED', endedAt: new Date() },
    });
    const afterEnd = await h.delinquents(educator.user);
    expect(afterEnd.body.items.map((i: { name: string }) => i.name)).toContain(
      'Independente',
    );
  });

  it('IT-005 a nutritionist with patients behaves like an educator', async () => {
    const nutritionist = await h.createUser(
      'it005-nut',
      h.products.premiumNutritionist,
    );
    const account = await h.createAccount(nutritionist);
    const patient = await h.createClient({
      professionalId: nutritionist.id,
      name: 'Paciente',
    });
    await invoiceFor(account, patient.id, {
      amountCents: 15000,
      dueDate: '2026-11-01',
    });

    const summary = await h.summary(nutritionist, '2026-11');
    const list = await h.delinquents(nutritionist);

    expect(summary.body).toMatchObject({
      audience: 'PROFESSIONAL',
      current: { expectedCents: 15000 },
    });
    expect(list.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Paciente',
    ]);
  });

  it('IT-006 invoices of a replaced account still count beside the new active one', async () => {
    const user = await h.createUser('it006', h.products.premiumEducator);
    const replaced = await h.createAccount(user, { status: 'REPLACED' });
    const active = await h.createAccount(user);
    const [old, current] = await Promise.all(
      [1, 2].map((n) =>
        h.createClient({ professionalId: user.id, name: `A${n}` }),
      ),
    );
    await invoiceFor(replaced, old.id, {
      amountCents: 10000,
      dueDate: '2026-11-01',
    });
    await invoiceFor(active, current.id, {
      amountCents: 20000,
      dueDate: '2026-11-02',
    });

    const summary = await h.summary(user, '2026-11');
    const list = await h.delinquents(user);

    expect(summary.body.overdue).toMatchObject({
      totalCents: 30000,
      delinquentCount: 2,
    });
    expect(list.body.total).toBe(2);
  });

  it('IT-007 an invoice stored as pending but due yesterday is overdue now, without touching its status', async () => {
    const { user, account } = await educatorWithAccount('it007');
    const c = await h.createClient({ professionalId: user.id });
    const invoice = await invoiceFor(account, c.id, {
      amountCents: 9000,
      dueDate: '2026-11-16',
      status: S.PENDING,
    });
    const dueToday = await h.createClient({
      professionalId: user.id,
      name: 'Vence hoje',
    });
    await invoiceFor(account, dueToday.id, {
      amountCents: 7000,
      dueDate: '2026-11-17',
      status: S.OVERDUE,
    });

    const summary = await h.summary(user, '2026-11');
    const list = await h.delinquents(user);

    expect(summary.body.overdue.bands).toEqual({
      d1to7Cents: 9000,
      d8to30Cents: 0,
      d31PlusCents: 0,
    });
    expect(
      list.body.items.map((i: { clientId: string }) => i.clientId),
    ).toEqual([c.id]);
    const stored = await h.prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(stored.status).toBe(S.PENDING);
  });

  it('IT-008 forty-five delinquents page by twenty, ties broken by oldest then name, past-the-end is the last page', async () => {
    const { user, account } = await educatorWithAccount('it008');
    const rows: { id: string; name: string; total: number; due: string }[] = [];
    for (let i = 0; i < 45; i += 1) {
      const name = `Aluno ${String(i).padStart(2, '0')}`;
      const client = await h.createClient({ professionalId: user.id, name });
      const total = 1000 * (1 + Math.floor(i / 3));
      const due = addDays('2026-11-01', -(i % 3));
      await invoiceFor(account, client.id, {
        amountCents: total,
        dueDate: due,
      });
      rows.push({ id: client.id, name, total, due });
    }
    const expected = [...rows].sort(
      (p, q) =>
        q.total - p.total ||
        p.due.localeCompare(q.due) ||
        p.name.localeCompare(q.name),
    );

    const first = await h.delinquents(user, '1');
    const third = await h.delinquents(user, '3');
    const ninth = await h.delinquents(user, '9');

    expect(first.body.total).toBe(45);
    expect(
      first.body.items.map((i: { clientId: string }) => i.clientId),
    ).toEqual(expected.slice(0, 20).map((r) => r.id));
    expect(third.body.items).toHaveLength(5);
    expect(
      third.body.items.map((i: { clientId: string }) => i.clientId),
    ).toEqual(expected.slice(40).map((r) => r.id));
    expect(ninth.body.page).toBe(3);
    expect(ninth.body.items).toEqual(third.body.items);
  });

  it('IT-008 equal totals and equal due dates fall back to the name', async () => {
    const { user, account } = await educatorWithAccount('it008b');
    for (const name of ['Zeca', 'Ana', 'Bia']) {
      const c = await h.createClient({ professionalId: user.id, name });
      await invoiceFor(account, c.id, {
        amountCents: 5000,
        dueDate: '2026-11-01',
      });
    }
    const older = await h.createClient({
      professionalId: user.id,
      name: 'Zulu',
    });
    await invoiceFor(account, older.id, {
      amountCents: 5000,
      dueDate: '2026-10-01',
    });

    const list = await h.delinquents(user);

    expect(list.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Zulu',
      'Ana',
      'Bia',
      'Zeca',
    ]);
  });

  it('IT-009 one student across several bands: totals add up, pending future invoices stay out of the total owed', async () => {
    const { user, account } = await educatorWithAccount('it009');
    const c = await h.createClient({ professionalId: user.id });
    await invoiceFor(account, c.id, {
      amountCents: 10000,
      dueDate: '2026-11-12',
      competence: { year: 2026, month: 11 },
    });
    await invoiceFor(account, c.id, {
      amountCents: 20000,
      dueDate: '2026-10-28',
      status: S.OVERDUE,
      competence: { year: 2026, month: 10 },
    });
    await invoiceFor(account, c.id, {
      amountCents: 30000,
      dueDate: '2026-10-08',
      status: S.OVERDUE,
      competence: { year: 2026, month: 9 },
    });
    await invoiceFor(account, c.id, {
      amountCents: 15000,
      dueDate: '2026-12-05',
      competence: { year: 2026, month: 12 },
    });

    const summary = await h.summary(user, '2026-11');
    const list = await h.delinquents(user);

    expect(summary.body.overdue).toEqual({
      totalCents: 60000,
      delinquentCount: 1,
      bands: { d1to7Cents: 10000, d8to30Cents: 20000, d31PlusCents: 30000 },
    });
    expect(list.body.items).toEqual([
      {
        clientId: c.id,
        name: expect.any(String),
        totalOwedCents: 60000,
        overdueCount: 3,
        oldestDaysOverdue: 40,
      },
    ]);
  });

  it('IT-010 a dismissed churn-risk alert never removes an overdue student from the list', async () => {
    const { user, account } = await educatorWithAccount('it010');
    const c = await h.createClient({ professionalId: user.id });
    await invoiceFor(account, c.id, {
      amountCents: 8000,
      dueDate: '2026-11-01',
    });
    await h.prisma.churnRiskEpisode.create({
      data: {
        clientId: c.id,
        reason: 'OVERDUE_PAYMENT',
        dismissedAt: new Date(),
      },
    });

    const list = await h.delinquents(user);

    expect(
      list.body.items.map((i: { clientId: string }) => i.clientId),
    ).toEqual([c.id]);
  });

  it('IT-011 removing a student takes their invoices out of the figures and closes their billing tab', async () => {
    const { user, account } = await educatorWithAccount('it011');
    const kept = await h.createClient({
      professionalId: user.id,
      name: 'Fica',
    });
    const removed = await h.createClient({
      professionalId: user.id,
      name: 'Sai',
    });
    await invoiceFor(account, kept.id, {
      amountCents: 10000,
      dueDate: '2026-11-01',
    });
    await invoiceFor(account, removed.id, {
      amountCents: 20000,
      dueDate: '2026-11-01',
    });
    expect((await h.summary(user, '2026-11')).body.current.expectedCents).toBe(
      30000,
    );

    await h.prisma.client.delete({ where: { id: removed.id } });

    const summary = await h.summary(user, '2026-11');
    const list = await h.delinquents(user);
    const tab = await h.get(
      user,
      'get',
      `/billing/students/${removed.id}/invoices`,
    );
    expect(summary.body.current.expectedCents).toBe(10000);
    expect(list.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Fica',
    ]);
    expect(tab.status).toBe(404);
  });
});

describe('Access, states and validation (IT-012 to IT-015)', () => {
  it('IT-012 each audience sees only its own scope and everyone else is refused', async () => {
    const gymA = await h.createGymOwner('it012-a');
    const gymB = await h.createGymOwner('it012-b');
    const accountA = await h.createAccount(gymA.owner);
    const accountB = await h.createAccount(gymB.owner);
    const studentA = await h.createClient({
      academiaId: gymA.academiaId,
      name: 'Aluno A',
    });
    const studentB = await h.createClient({
      academiaId: gymB.academiaId,
      name: 'Aluno B',
    });
    await invoiceFor(accountA, studentA.id, {
      amountCents: 11000,
      dueDate: '2026-11-01',
    });
    await invoiceFor(accountB, studentB.id, {
      amountCents: 22000,
      dueDate: '2026-11-01',
    });
    const educator = await educatorWithAccount('it012-edu');
    await h.prisma.employment.create({
      data: {
        academiaId: gymA.academiaId,
        educatorId: educator.user.id,
        status: 'ACTIVE',
      },
    });
    const student = await h.createUser('it012-student', h.products.user);
    const receptionist = await h.prisma.academiaStaffMember.create({
      data: {
        academiaId: gymA.academiaId,
        name: 'Recepcao',
        email: `${h.tag}-recep@integration.test`,
        active: true,
      },
    });

    const owner = await h.get(
      gymA.owner,
      'get',
      `/financial-health/summary?month=2026-11&academiaId=${gymB.academiaId}`,
    );
    const other = await h.summary(gymB.owner, '2026-11');
    const employed = await h.summary(educator.user, '2026-11');
    const asStudent = await h.summary(student, '2026-11');
    const asReceptionist = await h.get(
      { id: receptionist.id, email: receptionist.email },
      'get',
      '/financial-health/summary',
    );

    expect(owner.status).toBe(200);
    expect(owner.body).toMatchObject({
      audience: 'GYM',
      current: { expectedCents: 11000 },
    });
    expect(other.body.current.expectedCents).toBe(22000);
    expect(employed.status).toBe(200);
    expect(employed.body).toMatchObject({
      audience: 'PROFESSIONAL',
      current: { expectedCents: 0 },
    });
    expect(asStudent.status).toBe(403);
    expect(asStudent.body.code).toBe('not_billing_owner');
    expect(asReceptionist.status).toBe(401);
    expect((await h.delinquents(student)).status).toBe(403);
  });

  it('IT-013 the panel states: not connected, connected, reconnect needed with figures, lapsed Premium with figures', async () => {
    const fresh = await h.createUser('it013-fresh', h.products.premiumEducator);
    const empty = await h.summary(fresh, '2026-11');
    expect(empty.body).toMatchObject({
      billingState: 'NOT_CONNECTED',
      hasHistory: false,
      current: { expectedCents: 0 },
    });

    const connected = await educatorWithAccount('it013-ok');
    expect((await h.summary(connected.user, '2026-11')).body).toMatchObject({
      billingState: 'CONNECTED',
      hasHistory: false,
    });

    const broken = await h.createUser(
      'it013-broken',
      h.products.premiumEducator,
    );
    const brokenAccount = await h.createAccount(broken, {
      keyInvalidAt: new Date(),
    });
    const client = await h.createClient({ professionalId: broken.id });
    await invoiceFor(brokenAccount, client.id, {
      amountCents: 12000,
      dueDate: '2026-11-03',
    });
    expect((await h.summary(broken, '2026-11')).body).toMatchObject({
      billingState: 'RECONNECT_NEEDED',
      hasHistory: true,
      current: { expectedCents: 12000 },
    });

    const lapsed = await h.createUser(
      'it013-lapsed',
      h.products.standardEducator,
    );
    const lapsedAccount = await h.createAccount(lapsed, {
      status: 'DISCONNECTED',
      disconnected: true,
    });
    const lapsedClient = await h.createClient({ professionalId: lapsed.id });
    await invoiceFor(lapsedAccount, lapsedClient.id, {
      amountCents: 5000,
      dueDate: '2026-11-03',
    });
    const lapsedPanel = await h.summary(lapsed, '2026-11');
    expect(lapsedPanel.status).toBe(200);
    expect(lapsedPanel.body).toMatchObject({
      billingState: 'NOT_CONNECTED',
      hasHistory: true,
      current: { expectedCents: 5000 },
    });
  });

  it('IT-014 only the current month and the twelve before it are valid, and no page value ever errors', async () => {
    const { user } = await educatorWithAccount('it014');

    for (const bad of ['2026-13', '2026-12', '2025-10', 'abc', '26-1']) {
      const response = await h.summary(user, bad);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('invalid_month');
    }
    const oldest = await h.summary(user, '2025-11');
    expect(oldest.status).toBe(200);
    expect(oldest.body.current).toEqual({
      expectedCents: 0,
      receivedCents: 0,
      stillOwedCents: 0,
    });
    expect((await h.summary(user)).body.month).toBe('2026-11');
    for (const page of ['0', 'abc', '99', '-1']) {
      expect((await h.delinquents(user, page)).status).toBe(200);
    }
  });

  it('IT-015 payment dates and “today” are Brasília dates', async () => {
    const { user, account } = await educatorWithAccount('it015');
    const [a, b, late] = await Promise.all(
      [1, 2, 3].map((n) =>
        h.createClient({ professionalId: user.id, name: `B${n}` }),
      ),
    );
    await invoiceFor(account, a.id, {
      amountCents: 10000,
      dueDate: '2026-11-20',
      status: S.PAID,
      paidAt: '2026-11-30',
    });
    await invoiceFor(account, b.id, {
      amountCents: 20000,
      dueDate: '2026-11-20',
      status: S.PAID,
      paidAt: '2026-12-01',
    });
    await invoiceFor(account, late.id, {
      amountCents: 5000,
      dueDate: '2026-11-16',
    });

    const november = await h.summary(user, '2026-11');
    expect(november.body.current.receivedCents).toBe(10000);

    h.setNow('2026-11-17T02:59:59Z');
    const beforeMidnight = await h.summary(user, '2026-11');
    expect(beforeMidnight.body.overdue.totalCents).toBe(0);

    h.setNow('2026-11-17T03:00:00Z');
    const afterMidnight = await h.summary(user, '2026-11');
    expect(afterMidnight.body.overdue.bands.d1to7Cents).toBe(5000);
  });
});

describe('Scale and concurrency (IT-016, IT-017, IT-040)', () => {
  it('IT-016 twenty thousand invoices over two thousand clients: exact totals within a second, aggregates only', async () => {
    const { user, account } = await educatorWithAccount('it016');
    const clientRows = Array.from({ length: 2000 }, (_, i) => ({
      id: `${h.tag}-c${String(i).padStart(4, '0')}`,
      name: `Cliente ${String(i).padStart(4, '0')}`,
      phone: '11999990000',
      email: `${h.tag}-scale-${i}@integration.test`,
      professionalId: user.id,
    }));
    await h.prisma.client.createMany({ data: clientRows });

    // Ten invoices per client (competence g+1), one per kind. Selected
    // month: November 2026; today: 2026-11-17.
    const kinds: {
      dueDate: string;
      status: InvoiceStatus;
      paidAt?: string;
    }[] = [
      { dueDate: '2026-11-02', status: S.PAID, paidAt: '2026-11-02' },
      { dueDate: '2026-11-20', status: S.PENDING },
      { dueDate: '2026-03-15', status: S.PAID, paidAt: '2026-03-15' },
      { dueDate: '2026-04-15', status: S.PAID, paidAt: '2026-04-15' },
      { dueDate: '2026-05-15', status: S.PAID_MANUALLY, paidAt: '2026-11-05' },
      { dueDate: '2026-06-15', status: S.PAID, paidAt: '2026-06-15' },
      { dueDate: '2026-10-28', status: S.OVERDUE },
      { dueDate: '2026-08-15', status: S.PENDING },
      { dueDate: '2026-09-15', status: S.CANCELED },
      { dueDate: '2026-11-12', status: S.PENDING },
    ];
    const expected = {
      expected: 0,
      received: 0,
      stillOwed: 0,
      d1to7: 0,
      d8to30: 0,
      d31: 0,
      delinquents: 0,
    };
    const invoices: Prisma.InvoiceCreateManyInput[] = [];
    for (let c = 0; c < clientRows.length; c += 1) {
      let late = false;
      kinds.forEach((kind, g) => {
        const amountCents = 1000 + (c % 7) * 100 + g;
        const isPaid =
          kind.status === S.PAID || kind.status === S.PAID_MANUALLY;
        invoices.push({
          clientId: clientRows[c].id,
          billingAccountId: account.id,
          competenceYear: 2026,
          competenceMonth: g + 1,
          amountCents,
          dueDate: new Date(kind.dueDate),
          status: kind.status,
          externalId: `scale_${h.tag}_${c}_${g}`,
          paidAt: kind.paidAt ? new Date(kind.paidAt) : null,
          paidAmountCents: isPaid ? amountCents : null,
        });
        if (kind.status === S.CANCELED) return;
        if (kind.dueDate.startsWith('2026-11'))
          expected.expected += amountCents;
        if (isPaid && kind.paidAt!.startsWith('2026-11'))
          expected.received += amountCents;
        if (!isPaid && kind.dueDate.startsWith('2026-11'))
          expected.stillOwed += amountCents;
        if (isPaid || kind.dueDate >= '2026-11-17') return;
        late = true;
        const days = Math.round(
          (Date.parse('2026-11-17') - Date.parse(kind.dueDate)) / 86_400_000,
        );
        if (days <= 7) expected.d1to7 += amountCents;
        else if (days <= 30) expected.d8to30 += amountCents;
        else expected.d31 += amountCents;
      });
      if (late) expected.delinquents += 1;
    }
    for (let i = 0; i < invoices.length; i += 2000) {
      await h.prisma.invoice.createMany({ data: invoices.slice(i, i + 2000) });
    }

    // The suite runs against a remote database, so a cold pool and the
    // network round trips (a handful per request) are not the aggregate's cost:
    // warm the pool first and budget 1 s of work plus four measured round trips.
    await h.summary(user, '2026-11');
    const rttStarted = Date.now();
    await h.prisma.$queryRaw`SELECT 1`;
    const budgetMs = 1000 + 4 * (Date.now() - rttStarted);
    const started = Date.now();
    const summary = await h.summary(user, '2026-11');
    const summaryMs = Date.now() - started;
    const listStarted = Date.now();
    const list = await h.delinquents(user, '1');
    const listMs = Date.now() - listStarted;

    expect(summary.status).toBe(200);
    expect(summary.body.current).toEqual({
      expectedCents: expected.expected,
      receivedCents: expected.received,
      stillOwedCents: expected.stillOwed,
    });
    expect(summary.body.overdue.bands).toEqual({
      d1to7Cents: expected.d1to7,
      d8to30Cents: expected.d8to30,
      d31PlusCents: expected.d31,
    });
    expect(summary.body.overdue.delinquentCount).toBe(expected.delinquents);
    expect(list.body.total).toBe(expected.delinquents);
    expect(list.body.items).toHaveLength(20);
    expect(JSON.stringify(summary.body)).not.toContain('invoiceId');
    expect(summaryMs).toBeLessThan(budgetMs);
    expect(listMs).toBeLessThan(budgetMs);
  });

  it('IT-017 a payment landing mid-read shows either the before or the after state, never a mixture', async () => {
    const user = await h.createUser('it017', h.products.premiumEducator);
    const token = await h.connectViaApi(user, `${h.tag}-it017-key`);
    const account = await h.prisma.billingAccount.findFirstOrThrow({
      where: { userId: user.id, status: 'ACTIVE' },
    });
    const client = await h.createClient({ professionalId: user.id });
    const fee = await h.seedGymFee({
      account,
      clientId: client.id,
      competence: { year: 2026, month: 11 },
      amountCents: 20000,
      dueDate: '2026-11-25',
    });
    h.fake.setChargeStatus(fee.externalId!, 'RECEIVED', '2026-11-17');

    const [notice, ...reads] = await Promise.all([
      h.notice(fee.externalId!, token),
      ...Array.from({ length: 50 }, () => h.summary(user, '2026-11')),
    ]);

    expect(notice.status).toBe(200);
    const states = new Set(
      reads.map(
        (r) =>
          `${r.body.current.stillOwedCents}/${r.body.current.receivedCents}`,
      ),
    );
    for (const state of states) expect(['20000/0', '0/20000']).toContain(state);
    const settled = await h.summary(user, '2026-11');
    expect(settled.body.current).toMatchObject({
      stillOwedCents: 0,
      receivedCents: 20000,
    });
  });

  it('IT-040 a removed gym student leaves the totals and the delinquent list on the next request', async () => {
    const { owner, academiaId } = await h.createGymOwner('it040');
    const account = await h.createAccount(owner);
    const stays = await h.createClient({ academiaId, name: 'Continua' });
    const leaves = await h.createClient({ academiaId, name: 'Removido' });
    await invoiceFor(account, stays.id, {
      amountCents: 10000,
      dueDate: '2026-11-01',
    });
    await invoiceFor(account, leaves.id, {
      amountCents: 20000,
      dueDate: '2026-11-01',
    });
    expect((await h.delinquents(owner)).body.total).toBe(2);

    await h.prisma.client.delete({ where: { id: leaves.id } });

    const list = await h.delinquents(owner);
    const summary = await h.summary(owner, '2026-11');
    expect(list.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Continua',
    ]);
    expect(summary.body.current.expectedCents).toBe(10000);
    expect(
      await h.prisma.invoice.count({ where: { clientId: leaves.id } }),
    ).toBe(0);
  });
});

describe('Journeys (E2E-001 to E2E-004, E2E-012)', () => {
  function createInvoiceBody(amount: string, dueDate: string) {
    const today = realToday();
    return {
      competenceYear: Number(today.slice(0, 4)),
      competenceMonth: Number(today.slice(5, 7)),
      amount,
      dueDate,
      cpfCnpj: '529.982.247-25',
    };
  }

  it('E2E-001 a Premium educator invoices three students, one is paid by webhook, one goes overdue: the panel tells the story', async () => {
    h.now = new Date();
    const educator = await h.createUser('e2e001', h.products.premiumEducator);
    const token = await h.connectViaApi(educator, `${h.tag}-e2e001-key`);
    const [paying, late, pending] = await Promise.all(
      ['Paga', 'Atrasada', 'Pendente'].map((name) =>
        h.createClient({ professionalId: educator.id, name }),
      ),
    );
    const today = realToday();
    const create = async (clientId: string, amount: string) => {
      const response = await h
        .get(educator, 'post', `/billing/students/${clientId}/invoices`)
        .send(createInvoiceBody(amount, today));
      expect(response.status).toBe(201);
      return response.body.id as string;
    };
    const payingId = await create(paying.id, '100.00');
    const lateId = await create(late.id, '300.00');
    await create(pending.id, '200.00');

    const payingRow = await h.prisma.invoice.findUniqueOrThrow({
      where: { id: payingId },
    });
    h.fake.setChargeStatus(payingRow.externalId!, 'RECEIVED', today);
    expect((await h.notice(payingRow.externalId!, token)).status).toBe(200);
    const lateDue = addDays(today, -3);
    await h.prisma.invoice.update({
      where: { id: lateId },
      data: { dueDate: new Date(lateDue) },
    });

    const summary = await h.summary(educator);
    const delinquents = await h.delinquents(educator);
    const tab = await h.get(
      educator,
      'get',
      `/billing/students/${late.id}/invoices`,
    );

    const inMonth = (key: string) => key.slice(0, 7) === today.slice(0, 7);
    expect(summary.status).toBe(200);
    expect(summary.body.current).toEqual({
      expectedCents: 10000 + 20000 + (inMonth(lateDue) ? 30000 : 0),
      receivedCents: 10000,
      stillOwedCents: 20000 + (inMonth(lateDue) ? 30000 : 0),
    });
    expect(summary.body.overdue).toMatchObject({
      totalCents: 30000,
      delinquentCount: 1,
      bands: { d1to7Cents: 30000 },
    });
    expect(delinquents.body.items.map((i: { name: string }) => i.name)).toEqual(
      ['Atrasada'],
    );
    expect(tab.status).toBe(200);
    expect(tab.body.items).toHaveLength(1);
  });

  it('E2E-002 the month selector: current and previous carry comparison values, a bad month is refused, a deep-linked past month answers with its own figures', async () => {
    const { user, account } = await educatorWithAccount('e2e002');
    const c = await h.createClient({ professionalId: user.id });
    await invoiceFor(account, c.id, {
      amountCents: 40000,
      dueDate: '2026-08-10',
      status: S.PAID,
      paidAt: '2026-08-12',
    });
    await invoiceFor(account, c.id, {
      amountCents: 50000,
      dueDate: '2026-11-10',
      competence: { year: 2026, month: 11 },
    });

    const current = await h.summary(user);
    const previous = await h.summary(user, '2026-10');
    const bad = await h.summary(user, '2026-13');
    const deepLink = await h.summary(user, '2026-08');

    expect(current.body.current.expectedCents).toBe(50000);
    expect(current.body.previous).toEqual({
      expectedCents: 0,
      receivedCents: 0,
      stillOwedCents: 0,
    });
    expect(previous.body.month).toBe('2026-10');
    expect(previous.body.previous).toBeDefined();
    expect(bad.status).toBe(400);
    expect(deepLink.body).toMatchObject({
      month: '2026-08',
      current: {
        expectedCents: 40000,
        receivedCents: 40000,
        stillOwedCents: 0,
      },
    });
  });

  it('E2E-003 an educator without an account starts NOT_CONNECTED, connects, and sees figures after the first invoice', async () => {
    h.now = new Date();
    const educator = await h.createUser('e2e003', h.products.premiumEducator);
    const client = await h.createClient({ professionalId: educator.id });

    const before = await h.summary(educator);
    expect(before.body).toMatchObject({
      billingState: 'NOT_CONNECTED',
      hasHistory: false,
    });

    await h.connectViaApi(educator, `${h.tag}-e2e003-key`);
    const connected = await h.summary(educator);
    expect(connected.body).toMatchObject({
      billingState: 'CONNECTED',
      hasHistory: false,
    });

    const created = await h
      .get(educator, 'post', `/billing/students/${client.id}/invoices`)
      .send(createInvoiceBody('150.00', realToday()));
    expect(created.status).toBe(201);
    const after = await h.summary(educator);
    expect(after.body).toMatchObject({
      billingState: 'CONNECTED',
      hasHistory: true,
      current: { expectedCents: 15000 },
    });
  });

  it('E2E-004 a nutritionist uses the same endpoints and sees only their own patients', async () => {
    const nutritionist = await h.createUser(
      'e2e004',
      h.products.premiumNutritionist,
    );
    const other = await h.createUser(
      'e2e004-other',
      h.products.premiumNutritionist,
    );
    const account = await h.createAccount(nutritionist);
    const otherAccount = await h.createAccount(other);
    const mine = await h.createClient({
      professionalId: nutritionist.id,
      name: 'Minha paciente',
    });
    const theirs = await h.createClient({
      professionalId: other.id,
      name: 'Outra paciente',
    });
    await invoiceFor(account, mine.id, {
      amountCents: 18000,
      dueDate: '2026-11-02',
    });
    await invoiceFor(otherAccount, theirs.id, {
      amountCents: 99000,
      dueDate: '2026-11-02',
    });

    const summary = await h.summary(nutritionist, '2026-11');
    const list = await h.delinquents(nutritionist);

    expect(summary.body).toMatchObject({
      audience: 'PROFESSIONAL',
      current: { expectedCents: 18000 },
    });
    expect(list.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Minha paciente',
    ]);
  });

  it('E2E-012 a receptionist token is refused, an educator sees only their scope, a student is refused', async () => {
    const gym = await h.createGymOwner('e2e012');
    const receptionist = await h.prisma.academiaStaffMember.create({
      data: {
        academiaId: gym.academiaId,
        name: 'Recepcao',
        email: `${h.tag}-e2e012-recep@integration.test`,
        active: true,
      },
    });
    const educator = await educatorWithAccount('e2e012-edu');
    const student = await h.createUser('e2e012-student', h.products.user);

    const asReceptionist = await h.get(
      { id: receptionist.id, email: receptionist.email },
      'get',
      '/financial-health/summary',
    );
    const asEducator = await h.summary(educator.user, '2026-11');
    const asStudent = await h.summary(student, '2026-11');

    expect(asReceptionist.status).toBe(401);
    expect(asEducator.status).toBe(200);
    expect(asEducator.body.audience).toBe('PROFESSIONAL');
    expect(asStudent.status).toBe(403);
    expect(
      (
        await h.get(
          { id: 'nobody', email: 'x@x.test' },
          'get',
          '/financial-health/summary',
        )
      ).status,
    ).toBe(401);
    expect(
      (await request(h.server()).get('/financial-health/summary')).status,
    ).toBe(401);
  });
});
