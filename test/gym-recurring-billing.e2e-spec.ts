/**
 * Integration and end-to-end tests for PRD `professional-financial-health-
 * dashboard`, task 2: the gym's recurring monthly billing (link with fee terms,
 * change terms, unlink, bulk activation, the nightly issuer), the neutral
 * receptionist notice and the student's fees. They run the real Academia,
 * Academia-mirror, Billing and Financial-health modules against a migrated
 * database and the fake Asaas server; only the gateway, the mailer and the
 * clock are replaced.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AcademiaModule } from '@/academia/academia.module';
import { RecurringFeeIssuer } from '@/academia/billing/recurringFeeIssuer.service';
import { AcademiaMirrorModule } from '@/academia-mirror/academiaMirror.module';
import { brasiliaDateKey } from '@/billing/shared/dates';
import { InvoicesRepository } from '@/repositories/billing/invoices.repository';
import {
  AcademiaAccessPlan,
  AcademiaStaffMember,
  BillingAccount,
  BillingAccountStatus,
  Client,
  InvoiceStatus,
  Users,
} from '@prisma/client';
import { FinancialHealthHarness } from './support/financialHealthHarness';

jest.setTimeout(300_000);

const h = new FinancialHealthHarness(`gymbill-${Date.now()}`, [
  AcademiaModule,
  AcademiaMirrorModule,
]);

const TODAY = '2026-11-17';
const NOON = (key: string) => `${key}T15:00:00.000Z`;

function competence(key: string) {
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
}

interface Gym {
  owner: Users;
  academiaId: string;
  account: BillingAccount;
  apiKey: string;
  token: string;
  plan: AcademiaAccessPlan;
}

// A connected gym (through the real route, so the webhook token exists) with
// a 149.90 plan in its catalog.
async function gym(label: string, priceReais = 149.9): Promise<Gym> {
  const { owner, academiaId } = await h.createGymOwner(label);
  const apiKey = `${h.tag}-${label}-key`;
  const token = await h.connectViaApi(owner, apiKey);
  const account = await h.prisma.billingAccount.findFirstOrThrow({
    where: { userId: owner.id, status: BillingAccountStatus.ACTIVE },
  });
  const plan = await h.createAccessPlan(academiaId, { priceReais });
  return { owner, academiaId, account, apiKey, token, plan };
}

// A gym student with a tax ID on file, optionally with an app login.
async function student(
  g: Gym,
  options: { taxId?: boolean; login?: boolean; name?: string } = {},
): Promise<{ client: Client; user: Users | null }> {
  const user =
    options.login === true
      ? await h.createUser(`stu-${g.academiaId.slice(0, 6)}`, h.products.user)
      : null;
  const client = await h.createClient({
    academiaId: g.academiaId,
    userId: user?.id ?? null,
    name: options.name,
  });
  if (options.taxId !== false) await h.storeTaxId(client.id);
  return { client, user };
}

function link(g: Gym, clientId: string, body: Record<string, unknown>) {
  return h
    .get(g.owner, 'post', `/academia/students/${clientId}/access-plan`)
    .send(body);
}

function chargesOf(g: Gym) {
  return h.fake.requests.filter(
    (r) =>
      r.method === 'POST' &&
      r.path === '/payments' &&
      r.headers['access_token'] === g.apiKey,
  );
}

function invoicesOf(clientId: string) {
  return h.prisma.invoice.findMany({
    where: { clientId },
    orderBy: [{ competenceYear: 'asc' }, { competenceMonth: 'asc' }],
  });
}

function issuer(): RecurringFeeIssuer {
  return h.app.get(RecurringFeeIssuer);
}

beforeAll(async () => {
  await h.start();
});

afterAll(async () => {
  await h.stop();
});

beforeEach(() => {
  h.setNow(NOON(TODAY));
  h.sendNotificationEmail.mockClear();
  h.fake.clearChargeFailures();
});

// The issuer runs over every active row in the database: rows of earlier
// cases are removed so each case sees only its own.
afterEach(async () => {
  await h.prisma.gymRecurringBilling.deleteMany({
    where: { client: { email: { startsWith: h.tag } } },
  });
});

describe('Link with a monthly fee (IT-019, IT-020, IT-021)', () => {
  it('IT-019 linking with a due day creates the plan, the recurring row, the first fee and one charge, and tells the student', async () => {
    const g = await gym('it019');
    const { client, user } = await student(g, { login: true });

    const response = await link(g, client.id, {
      accessPlanId: g.plan.id,
      billing: { dueDay: 10 },
    });

    expect(response.status).toBe(201);
    expect(response.body.billing).toMatchObject({
      dueDay: 10,
      amountCents: 14990,
      customAmount: false,
      status: 'ACTIVE',
    });
    const plans = await h.prisma.studentAccessPlan.findMany({
      where: { clientId: client.id },
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].status).toBe('ACTIVE');
    const rows = await h.prisma.gymRecurringBilling.findMany({
      where: { clientId: client.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'ACTIVE',
      dueDay: 10,
      amountCents: 14990,
    });
    const invoices = await invoicesOf(client.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({
      amountCents: 14990,
      competenceYear: 2026,
      competenceMonth: 12,
      recurringBillingId: rows[0].id,
    });
    expect(invoices[0].dueDate.toISOString().slice(0, 10)).toBe('2026-12-10');
    expect(invoices[0].externalId).not.toBeNull();
    expect(chargesOf(g)).toHaveLength(1);
    expect(
      await h.prisma.notification.count({
        where: { userId: user!.id, category: 'BILLING' },
      }),
    ).toBe(1);
  });

  it('IT-019 an amount other than the plan price is the fee and is marked custom', async () => {
    const g = await gym('it019-custom');
    const { client } = await student(g);

    const response = await link(g, client.id, {
      accessPlanId: g.plan.id,
      billing: { dueDay: 10, amountCents: 12000 },
    });

    expect(response.status).toBe(201);
    const row = await h.prisma.gymRecurringBilling.findFirstOrThrow({
      where: { clientId: client.id },
    });
    expect(row).toMatchObject({ amountCents: 12000, customAmount: true });
    expect((await invoicesOf(client.id))[0].amountCents).toBe(12000);
  });

  it('IT-019 a student with no tax ID is refused with tax_id_required and nothing is written', async () => {
    const g = await gym('it019-notax');
    const { client } = await student(g, { taxId: false });

    const response = await link(g, client.id, {
      accessPlanId: g.plan.id,
      billing: { dueDay: 10 },
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('tax_id_required');
    expect(
      await h.prisma.studentAccessPlan.count({
        where: { clientId: client.id },
      }),
    ).toBe(0);
    expect(
      await h.prisma.gymRecurringBilling.count({
        where: { clientId: client.id },
      }),
    ).toBe(0);
    expect(await invoicesOf(client.id)).toHaveLength(0);
    expect(chargesOf(g)).toHaveLength(0);
  });

  it('IT-019 a tax ID sent in the request is stored encrypted and the fee is issued', async () => {
    const g = await gym('it019-cpf');
    const { client } = await student(g, { taxId: false });

    const response = await link(g, client.id, {
      accessPlanId: g.plan.id,
      billing: { dueDay: 10, cpfCnpj: '529.982.247-25' },
    });

    expect(response.status).toBe(201);
    const stored = await h.prisma.studentTaxId.findUniqueOrThrow({
      where: { clientId: client.id },
    });
    expect(stored.ciphertext).not.toContain('52998224725');
    expect(await invoicesOf(client.id)).toHaveLength(1);
  });

  it('IT-020 a charge the gateway refuses leaves the previous plan active and no new plan, recurring row or invoice', async () => {
    const g = await gym('it020');
    const { client } = await student(g);
    await h.linkStudentToPlan(client.id, g.plan);
    const before = await h.prisma.studentAccessPlan.findFirstOrThrow({
      where: { clientId: client.id },
    });

    h.fake.failNextCharges(1, 500);
    const down = await link(g, client.id, {
      accessPlanId: g.plan.id,
      billing: { dueDay: 10 },
    });
    h.fake.failNextCharges(1, 400);
    const rejected = await link(g, client.id, {
      accessPlanId: g.plan.id,
      billing: { dueDay: 10 },
    });

    expect(down.status).toBe(503);
    expect(rejected.status).toBe(422);
    const plans = await h.prisma.studentAccessPlan.findMany({
      where: { clientId: client.id },
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ id: before.id, status: 'ACTIVE' });
    expect(
      await h.prisma.gymRecurringBilling.count({
        where: { clientId: client.id },
      }),
    ).toBe(0);
    expect(await invoicesOf(client.id)).toHaveLength(0);
  });

  it('IT-021 two parallel links for the same student: one 201, one 409 recurring_billing_exists, one fee and one charge', async () => {
    const g = await gym('it021');
    const { client } = await student(g);
    const body = { accessPlanId: g.plan.id, billing: { dueDay: 10 } };

    const [one, two] = await Promise.all([
      link(g, client.id, body),
      link(g, client.id, body),
    ]);

    expect([one.status, two.status].sort()).toEqual([201, 409]);
    const refused = one.status === 409 ? one : two;
    expect(refused.body.code).toBe('recurring_billing_exists');
    expect(await invoicesOf(client.id)).toHaveLength(1);
    expect(chargesOf(g)).toHaveLength(1);
    expect(
      await h.prisma.gymRecurringBilling.count({
        where: { clientId: client.id },
      }),
    ).toBe(1);
  });
});

// A student already billed: plan linked, recurring row ACTIVE and the fee of
// `last` (a due date) on record, as the issuer would have left things.
async function billedStudent(
  g: Gym,
  options: {
    dueDay: number;
    last: string;
    amountCents?: number;
    customAmount?: boolean;
    login?: boolean;
    name?: string;
  },
) {
  const { client, user } = await student(g, {
    login: options.login,
    name: options.name,
  });
  await h.linkStudentToPlan(client.id, g.plan);
  const amountCents = options.amountCents ?? 14990;
  const row = await h.prisma.gymRecurringBilling.create({
    data: {
      clientId: client.id,
      accessPlanId: g.plan.id,
      dueDay: options.dueDay,
      amountCents,
      customAmount: options.customAmount ?? false,
      startedAt: new Date('2026-06-01T12:00:00.000Z'),
    },
  });
  const lastFee = await h.seedGymFee({
    account: g.account,
    clientId: client.id,
    competence: competence(options.last),
    amountCents,
    dueDate: options.last,
    status: InvoiceStatus.PAID,
    paidAt: options.last,
    recurringBillingId: row.id,
  });
  return { client, user, row, lastFee };
}

describe('Nightly issuer (IT-022, IT-023, IT-026, IT-039)', () => {
  it('IT-022 issues a fee 10 days before its due date, once, even when two runs start together, and tells the student once', async () => {
    const g = await gym('it022');
    const first = await billedStudent(g, {
      dueDay: 27,
      last: '2026-10-27',
      login: true,
    });

    h.setNow(NOON('2026-11-16'));
    await issuer().run();
    expect(await invoicesOf(first.client.id)).toHaveLength(1);

    h.setNow(NOON('2026-11-17'));
    await issuer().run();
    const afterRun = await invoicesOf(first.client.id);
    expect(afterRun).toHaveLength(2);
    expect(afterRun[1]).toMatchObject({
      competenceYear: 2026,
      competenceMonth: 11,
      amountCents: 14990,
      recurringBillingId: first.row.id,
    });
    expect(afterRun[1].dueDate.toISOString().slice(0, 10)).toBe('2026-11-27');

    await issuer().run();
    expect(await invoicesOf(first.client.id)).toHaveLength(2);

    const second = await billedStudent(g, {
      dueDay: 27,
      last: '2026-10-27',
      login: true,
    });
    const chargesBefore = chargesOf(g).length;
    await Promise.all([issuer().run(), issuer().run()]);

    expect(await invoicesOf(second.client.id)).toHaveLength(2);
    expect(chargesOf(g)).toHaveLength(chargesBefore + 1);
    expect(
      await h.prisma.notification.count({
        where: { userId: second.user!.id, category: 'BILLING' },
      }),
    ).toBe(1);
    expect(
      await h.prisma.notification.count({
        where: { userId: first.user!.id, category: 'BILLING' },
      }),
    ).toBe(1);
  });

  it('IT-023 no fee is issued while the key is rejected; after reconnecting the missed months (at most 3) come with due date today; after disconnecting nothing more, and the panel keeps the history', async () => {
    const g = await gym('it023');
    const billed = await billedStudent(g, { dueDay: 28, last: '2026-07-28' });
    await h.prisma.billingAccount.update({
      where: { id: g.account.id },
      data: { keyInvalidAt: new Date() },
    });

    h.setNow(NOON('2026-11-15'));
    await issuer().run();
    h.setNow(NOON('2026-11-16'));
    await issuer().run();
    expect(await invoicesOf(billed.client.id)).toHaveLength(1);

    h.setNow(NOON('2026-11-17'));
    await h.connectViaApi(g.owner, `${h.tag}-it023-key-2`);
    const renewed = await h.prisma.billingAccount.findFirstOrThrow({
      where: { userId: g.owner.id, status: BillingAccountStatus.ACTIVE },
    });
    await issuer().run();

    const caughtUp = (await invoicesOf(billed.client.id)).slice(1);
    expect(caughtUp.map((i) => i.competenceMonth)).toEqual([8, 9, 10]);
    for (const invoice of caughtUp) {
      expect(invoice.dueDate.toISOString().slice(0, 10)).toBe(TODAY);
      expect(invoice.billingAccountId).toBe(renewed.id);
    }

    const disconnect = await h.get(g.owner, 'delete', '/billing/account');
    expect(disconnect.status).toBeLessThan(300);
    h.setNow(NOON('2026-12-20'));
    await issuer().run();

    expect(await invoicesOf(billed.client.id)).toHaveLength(4);
    const panel = await h.summary(g.owner, '2026-11');
    expect(panel.status).toBe(200);
    expect(panel.body.current.expectedCents).toBe(3 * 14990);
    expect(panel.body.hasHistory).toBe(true);
  });

  it('IT-026 a run racing with a custom-amount change leaves exactly one fee for the month, with the old or the new amount', async () => {
    const g = await gym('it026');
    const billed = await billedStudent(g, { dueDay: 27, last: '2026-10-27' });

    const [, patch] = await Promise.all([
      issuer().run(),
      h
        .get(g.owner, 'patch', `/academia/students/${billed.client.id}/billing`)
        .send({ amountCents: 20000 }),
    ]);

    expect(patch.status).toBe(200);
    const november = (await invoicesOf(billed.client.id)).filter(
      (i) => i.competenceMonth === 11,
    );
    expect(november).toHaveLength(1);
    expect([14990, 20000]).toContain(november[0].amountCents);
  });

  it('IT-039 a gym whose subscription lapses gets no new fee, keeps its panel and cannot start a link or connect', async () => {
    const g = await gym('it039');
    const billed = await billedStudent(g, { dueDay: 27, last: '2026-10-27' });
    const second = await student(g);
    await h.prisma.users.update({
      where: { id: g.owner.id },
      data: { subscriptionStatus: 'canceled' },
    });

    await issuer().run();
    const panel = await h.summary(g.owner, '2026-10');
    const linkAttempt = await link(g, second.client.id, {
      accessPlanId: g.plan.id,
      billing: { dueDay: 10 },
    });
    const connect = await h
      .get(g.owner, 'put', '/billing/account')
      .send({ apiKey: `${h.tag}-it039-new-key` });

    expect(await invoicesOf(billed.client.id)).toHaveLength(1);
    expect(panel.status).toBe(200);
    expect(panel.body.current.expectedCents).toBe(14990);
    expect(linkAttempt.status).toBe(403);
    expect(linkAttempt.body.code).toBe('subscription_required');
    expect(
      await h.prisma.studentAccessPlan.count({
        where: { clientId: second.client.id },
      }),
    ).toBe(0);
    expect(connect.status).toBe(403);
    expect(connect.body.code).toBe('subscription_required');
  });
});

describe('Change terms and end the link (IT-024, IT-025)', () => {
  it('IT-024 unlinking archives the plan, ends the row, cancels the fee issued ahead and leaves the overdue one owed, and a second unlink is refused', async () => {
    const g = await gym('it024');
    const { client, row } = await billedStudent(g, {
      dueDay: 5,
      last: '2026-11-05',
      name: 'Aluno Devedor',
    });
    const overdue = await h.seedGymFee({
      account: g.account,
      clientId: client.id,
      competence: { year: 2026, month: 10 },
      amountCents: 14990,
      dueDate: '2026-10-05',
      status: InvoiceStatus.PENDING,
      recurringBillingId: row.id,
    });
    const ahead = await h.seedGymFee({
      account: g.account,
      clientId: client.id,
      competence: { year: 2026, month: 12 },
      amountCents: 14990,
      dueDate: '2026-12-05',
      status: InvoiceStatus.PENDING,
      recurringBillingId: row.id,
    });

    const first = await h.get(
      g.owner,
      'delete',
      `/academia/students/${client.id}/access-plan`,
    );
    const second = await h.get(
      g.owner,
      'delete',
      `/academia/students/${client.id}/access-plan`,
    );

    expect(first.status).toBe(204);
    expect(second.status).toBe(404);
    expect(second.body.code).toBe('student_has_no_plan');
    const plan = await h.prisma.studentAccessPlan.findFirstOrThrow({
      where: { clientId: client.id },
    });
    expect(plan.status).toBe('ARCHIVED');
    const ended = await h.prisma.gymRecurringBilling.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(ended.status).toBe('ENDED');
    expect(ended.endedAt).not.toBeNull();
    const stored = await invoicesOf(client.id);
    const byMonth = Object.fromEntries(
      stored.map((i) => [i.competenceMonth, i.status]),
    );
    expect(byMonth).toEqual({ 10: 'PENDING', 11: 'PAID', 12: 'CANCELED' });
    expect(h.fake.charges.get(ahead.externalId!)!.deleted).toBe(true);
    expect(h.fake.charges.get(overdue.externalId!)!.deleted).toBe(false);
    const owed = await h.delinquents(g.owner);
    expect(
      owed.body.items.map((i: { clientId: string }) => i.clientId),
    ).toEqual([client.id]);

    await issuer().run();
    expect(await invoicesOf(client.id)).toHaveLength(3);
  });

  it('IT-025 re-assigning a pricier plan moves a non-custom row to the new price for the next fee only, and a due-day change leaves the issued fee alone', async () => {
    const g = await gym('it025');
    const { client } = await student(g);
    const bigger = await h.createAccessPlan(g.academiaId, {
      priceReais: 249.9,
    });
    const linked = await link(g, client.id, {
      accessPlanId: g.plan.id,
      billing: { dueDay: 10 },
    });
    expect(linked.status).toBe(201);

    const reassigned = await link(g, client.id, { accessPlanId: bigger.id });
    const changed = await h
      .get(g.owner, 'patch', `/academia/students/${client.id}/billing`)
      .send({ dueDay: 20 });

    expect(reassigned.status).toBe(201);
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({
      dueDay: 20,
      amountCents: 24990,
      accessPlanId: bigger.id,
    });
    const issued = await invoicesOf(client.id);
    expect(issued).toHaveLength(1);
    expect(issued[0].amountCents).toBe(14990);
    expect(issued[0].dueDate.toISOString().slice(0, 10)).toBe('2026-12-10');

    h.setNow(NOON('2027-01-10'));
    await issuer().run();
    const next = (await invoicesOf(client.id))[1];
    expect(next).toMatchObject({
      competenceYear: 2027,
      competenceMonth: 1,
      amountCents: 24990,
    });
    expect(next.dueDate.toISOString().slice(0, 10)).toBe('2027-01-20');
  });

  it('IT-025 a custom amount survives a re-assignment and an edited catalog price', async () => {
    const g = await gym('it025-custom');
    const { client } = await student(g);
    const bigger = await h.createAccessPlan(g.academiaId, {
      priceReais: 249.9,
    });
    await link(g, client.id, {
      accessPlanId: g.plan.id,
      billing: { dueDay: 10, amountCents: 12000 },
    });

    await link(g, client.id, { accessPlanId: bigger.id });
    await h.prisma.academiaAccessPlan.update({
      where: { id: bigger.id },
      data: { referencePrice: 259.9 },
    });

    const row = await h.prisma.gymRecurringBilling.findFirstOrThrow({
      where: { clientId: client.id, status: 'ACTIVE' },
    });
    expect(row).toMatchObject({
      amountCents: 12000,
      customAmount: true,
      accessPlanId: bigger.id,
    });
    h.setNow(NOON('2027-01-10'));
    await issuer().run();
    expect((await invoicesOf(client.id))[1].amountCents).toBe(12000);
  });

  it('IT-025 a non-custom row follows the catalog price when it is edited, from the next fee', async () => {
    const g = await gym('it025-catalog');
    const billed = await billedStudent(g, { dueDay: 27, last: '2026-10-27' });
    await h.prisma.academiaAccessPlan.update({
      where: { id: g.plan.id },
      data: { referencePrice: 159.9 },
    });

    await issuer().run();

    const [, next] = await invoicesOf(billed.client.id);
    expect(next.amountCents).toBe(15990);
  });

  it('IT-025 changing the terms of a student with no active billing is recurring_billing_not_found', async () => {
    const g = await gym('it025-none');
    const { client } = await student(g);

    const response = await h
      .get(g.owner, 'patch', `/academia/students/${client.id}/billing`)
      .send({ dueDay: 20 });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('recurring_billing_not_found');
  });
});

describe('Bulk activation (IT-027)', () => {
  it('IT-027 lists the four eligible students, activates three, skips the one with no tax ID, and a repeat skips the activated ones', async () => {
    const g = await gym('it027');
    const students = [] as Client[];
    for (const withTax of [true, true, true, false]) {
      const { client } = await student(g, { taxId: withTax });
      await h.linkStudentToPlan(client.id, g.plan);
      students.push(client);
    }

    const eligible = await h.get(
      g.owner,
      'get',
      '/academia/students/billing/eligible',
    );
    const items = students.map((s) => ({ clientId: s.id, dueDay: 20 }));
    const first = await h
      .get(g.owner, 'post', '/academia/students/billing/activate')
      .send({ items });
    const repeat = await h
      .get(g.owner, 'post', '/academia/students/billing/activate')
      .send({ items: items.slice(0, 3) });

    expect(eligible.status).toBe(200);
    expect(eligible.body).toHaveLength(4);
    expect(
      eligible.body.filter((e: { hasTaxId: boolean }) => !e.hasTaxId),
    ).toHaveLength(1);
    expect(first.status).toBe(200);
    expect(first.body.activated).toHaveLength(3);
    expect(first.body.skipped).toEqual([
      { clientId: students[3].id, reason: 'tax_id_missing' },
    ]);
    expect(
      await h.prisma.invoice.count({
        where: { clientId: { in: students.map((s) => s.id) } },
      }),
    ).toBe(3);
    expect(repeat.body.activated).toEqual([]);
    expect(
      repeat.body.skipped.map((s: { reason: string }) => s.reason),
    ).toEqual(['already_billing', 'already_billing', 'already_billing']);
    expect(chargesOf(g)).toHaveLength(3);
  });

  it('IT-027 an empty selection, a selection of 201 and a gym with no connected account are each refused with their own code', async () => {
    const g = await gym('it027-limits');
    const tooMany = Array.from({ length: 201 }, (_, i) => ({
      clientId: `missing-${i}`,
    }));
    const unconnected = await h.createGymOwner('it027-unconnected');
    const someone = await student({ ...g, academiaId: unconnected.academiaId });

    const empty = await h
      .get(g.owner, 'post', '/academia/students/billing/activate')
      .send({ items: [] });
    const large = await h
      .get(g.owner, 'post', '/academia/students/billing/activate')
      .send({ items: tooMany });
    const noAccount = await h
      .get(unconnected.owner, 'post', '/academia/students/billing/activate')
      .send({ items: [{ clientId: someone.client.id, dueDay: 10 }] });

    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('empty_selection');
    expect(large.status).toBe(400);
    expect(large.body.code).toBe('selection_too_large');
    expect(noAccount.status).toBe(409);
    expect(noAccount.body.code).toBe('billing_not_connected');
  });
});

describe('Neutral notice at the front desk (IT-031)', () => {
  it('IT-031 a student with an overdue fee gets the notice and nothing else; paying clears it; a fee due today, another gym and the student’s own check-in carry none', async () => {
    const g = await gym('it031');
    const reception = await h.createReceptionist(g.academiaId);
    const owing = await student(g, { login: true });
    const fee = await h.seedGymFee({
      account: g.account,
      clientId: owing.client.id,
      competence: { year: 2026, month: 11 },
      amountCents: 14990,
      dueDate: '2026-11-10',
      status: InvoiceStatus.PENDING,
    });
    const checkIn = (who: AcademiaStaffMember, clientId: string) =>
      h.get(who, 'post', `/academia/staff/students/${clientId}/checkin`).send();

    const noticed = await checkIn(reception, owing.client.id);
    h.fake.setChargeStatus(fee.externalId!, 'RECEIVED', TODAY);
    expect((await h.notice(fee.externalId!, g.token)).status).toBe(200);
    const cleared = await checkIn(reception, owing.client.id);

    expect(noticed.status).toBe(201);
    expect(Object.keys(noticed.body).sort()).toEqual([
      'createdAt',
      'id',
      'notice',
    ]);
    expect(noticed.body.notice).toBe('SEE_ADMINISTRATION');
    expect(cleared.body.notice).toBeNull();

    const dueToday = await student(g);
    await h.seedGymFee({
      account: g.account,
      clientId: dueToday.client.id,
      competence: { year: 2026, month: 11 },
      amountCents: 14990,
      dueDate: TODAY,
    });
    expect(
      (await checkIn(reception, dueToday.client.id)).body.notice,
    ).toBeNull();

    const other = await gym('it031-other');
    const otherReception = await h.createReceptionist(other.academiaId);
    const foreign = await checkIn(otherReception, owing.client.id);
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('student_not_found');

    const own = await h.get(owing.user!, 'post', '/checkins').send();
    expect(own.status).toBe(201);
    expect(own.body).not.toHaveProperty('notice');
  });

  it('IT-031 a failing fee lookup still records the check-in, with no notice', async () => {
    const g = await gym('it031-fault');
    const reception = await h.createReceptionist(g.academiaId);
    const { client } = await student(g);
    await h.seedGymFee({
      account: g.account,
      clientId: client.id,
      competence: { year: 2026, month: 10 },
      amountCents: 14990,
      dueDate: '2026-10-10',
    });
    const lookup = jest
      .spyOn(InvoicesRepository.prototype, 'findOpenAndOverdueByClient')
      .mockRejectedValueOnce(new Error('injected fault'));

    const response = await h
      .get(reception, 'post', `/academia/staff/students/${client.id}/checkin`)
      .send();

    lookup.mockRestore();
    expect(response.status).toBe(201);
    expect(response.body.notice).toBeNull();
    expect(
      await h.prisma.checkIn.count({ where: { clientId: client.id } }),
    ).toBe(1);
  });
});

describe('The student’s own fees (IT-032)', () => {
  it('IT-032 shows the student their own open and paid fees with the payment link, never a canceled one or another student’s', async () => {
    const g = await gym('it032');
    const mine = await student(g, { login: true });
    const other = await student(g, { login: true });
    const seed = (
      clientId: string,
      month: number,
      dueDate: string,
      status: InvoiceStatus,
    ) =>
      h.seedGymFee({
        account: g.account,
        clientId,
        competence: { year: 2026, month },
        amountCents: 14990,
        dueDate,
        status,
        paidAt: status === InvoiceStatus.PAID ? dueDate : null,
        paymentUrl: `https://pay.test/${clientId}-${month}`,
      });
    await seed(mine.client.id, 12, '2026-12-10', InvoiceStatus.PENDING);
    await seed(mine.client.id, 11, '2026-11-10', InvoiceStatus.PAID);
    await seed(mine.client.id, 10, '2026-10-20', InvoiceStatus.PENDING);
    await seed(mine.client.id, 9, '2026-09-10', InvoiceStatus.CANCELED);
    await seed(other.client.id, 12, '2026-12-10', InvoiceStatus.PENDING);
    const bystander = await h.createUser('it032-none', h.products.user);

    const response = await h.get(mine.user!, 'get', '/me/academia');
    const empty = await h.get(bystander, 'get', '/me/academia');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    const { fees } = response.body[0];
    expect(
      fees.map((f: { dueDate: string; status: string }) => [
        f.dueDate,
        f.status,
      ]),
    ).toEqual([
      ['2026-12-10', 'PENDING'],
      ['2026-11-10', 'PAID'],
      ['2026-10-20', 'OVERDUE'],
    ]);
    expect(fees[0]).toMatchObject({
      amountCents: 14990,
      paymentUrl: `https://pay.test/${mine.client.id}-12`,
    });
    expect(JSON.stringify(response.body)).not.toContain(other.client.id);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);
  });
});

describe('Gym journeys (E2E-006 to E2E-011)', () => {
  it('E2E-006 the owner links a student, the student sees and pays the fee, the owner’s panel follows, and the next month’s fee comes 10 days ahead', async () => {
    const g = await gym('e2e006');
    const { client, user } = await student(g, { login: true });

    const linked = await link(g, client.id, {
      accessPlanId: g.plan.id,
      billing: { dueDay: 17 },
    });
    expect(linked.status).toBe(201);
    expect(linked.body.firstInvoice.dueDate).toBe(TODAY);
    expect(linked.body.firstInvoice.amountCents).toBe(14990);

    const mirror = await h.get(user!, 'get', '/me/academia');
    expect(mirror.body[0].fees).toEqual([
      expect.objectContaining({
        id: linked.body.firstInvoice.id,
        amountCents: 14990,
        dueDate: TODAY,
        status: 'PENDING',
        paymentUrl: expect.stringContaining('https://'),
      }),
    ]);

    const fee = await h.prisma.invoice.findUniqueOrThrow({
      where: { id: linked.body.firstInvoice.id },
    });
    h.fake.setChargeStatus(fee.externalId!, 'RECEIVED', TODAY);
    expect((await h.notice(fee.externalId!, g.token)).status).toBe(200);

    const panel = await h.summary(g.owner);
    expect(panel.body.current.receivedCents).toBe(14990);
    expect((await h.delinquents(g.owner)).body.total).toBe(0);
    const paid = await h.get(user!, 'get', '/me/academia');
    expect(paid.body[0].fees[0]).toMatchObject({ status: 'PAID' });

    h.setNow(NOON('2026-12-06'));
    await issuer().run();
    expect(await invoicesOf(client.id)).toHaveLength(1);
    h.setNow(NOON('2026-12-07'));
    await issuer().run();
    const issued = await invoicesOf(client.id);
    expect(issued).toHaveLength(2);
    expect(issued[1]).toMatchObject({
      competenceYear: 2026,
      competenceMonth: 12,
    });
    expect(issued[1].dueDate.toISOString().slice(0, 10)).toBe('2026-12-17');
  });

  it('E2E-007 a gym fee gone overdue puts the student on the owner’s list; marking it paid takes them off', async () => {
    const g = await gym('e2e007');
    const { client } = await student(g, { name: 'Atrasado' });
    const linked = await link(g, client.id, {
      accessPlanId: g.plan.id,
      billing: { dueDay: 20 },
    });
    const feeId = linked.body.firstInvoice.id as string;
    await h.prisma.invoice.update({
      where: { id: feeId },
      data: { dueDate: new Date('2026-11-10') },
    });

    const before = await h.delinquents(g.owner);
    const paid = await h
      .get(g.owner, 'post', `/billing/invoices/${feeId}/mark-paid`)
      .send({ paidOn: brasiliaDateKey(new Date()) });
    const after = await h.delinquents(g.owner);

    expect(before.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Atrasado',
    ]);
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('PAID_MANUALLY');
    expect(after.body.total).toBe(0);
  });

  it('E2E-008 the receptionist’s check-in carries the neutral notice while a fee is overdue, none once it is paid, and the student’s own check-in never has one', async () => {
    const g = await gym('e2e008');
    const reception = await h.createReceptionist(g.academiaId);
    const { client, user } = await student(g, { login: true, name: 'Zélia' });
    const linked = await link(g, client.id, {
      accessPlanId: g.plan.id,
      billing: { dueDay: 20 },
    });
    const fee = await h.prisma.invoice.update({
      where: { id: linked.body.firstInvoice.id },
      data: { dueDate: new Date('2026-11-10') },
    });

    const found = await h
      .get(reception, 'get', '/academia/staff/students?search=zelia')
      .send();
    const checkIn = () =>
      h
        .get(reception, 'post', `/academia/staff/students/${client.id}/checkin`)
        .send();
    const owing = await checkIn();
    h.fake.setChargeStatus(fee.externalId!, 'RECEIVED', TODAY);
    await h.notice(fee.externalId!, g.token);
    const settled = await checkIn();
    const own = await h.get(user!, 'post', '/checkins').send();

    expect(found.body.map((s: { id: string }) => s.id)).toEqual([client.id]);
    expect(owing.body.notice).toBe('SEE_ADMINISTRATION');
    expect(JSON.stringify(owing.body)).not.toMatch(/amount|cents|days|owed/i);
    expect(settled.body.notice).toBeNull();
    expect(own.status).toBe(201);
    expect(own.body).not.toHaveProperty('notice');
  });

  it('E2E-009 link, change the due day, re-assign another plan and unlink: future fees are canceled, the overdue one stays, and the cron issues nothing afterwards', async () => {
    const g = await gym('e2e009');
    const { client } = await student(g);
    const bigger = await h.createAccessPlan(g.academiaId, {
      priceReais: 249.9,
    });
    const linked = await link(g, client.id, {
      accessPlanId: g.plan.id,
      billing: { dueDay: 20 },
    });
    expect(linked.status).toBe(201);
    await h
      .get(g.owner, 'patch', `/academia/students/${client.id}/billing`)
      .send({ dueDay: 25 });
    await link(g, client.id, { accessPlanId: bigger.id });
    await h.prisma.invoice.update({
      where: { id: linked.body.firstInvoice.id },
      data: { dueDate: new Date('2026-11-10') },
    });

    h.setNow(NOON('2026-12-15'));
    await issuer().run();
    const december = (await invoicesOf(client.id)).find(
      (i) => i.competenceMonth === 12,
    )!;
    expect(december).toMatchObject({ amountCents: 24990 });
    expect(december.dueDate.toISOString().slice(0, 10)).toBe('2026-12-25');

    const unlinked = await h.get(
      g.owner,
      'delete',
      `/academia/students/${client.id}/access-plan`,
    );
    expect(unlinked.status).toBe(204);
    const afterUnlink = await invoicesOf(client.id);
    expect(afterUnlink.map((i) => [i.competenceMonth, i.status])).toEqual([
      [11, 'PENDING'],
      [12, 'CANCELED'],
    ]);
    expect((await h.delinquents(g.owner)).body.total).toBe(1);

    h.setNow(NOON('2027-03-01'));
    await issuer().run();
    expect(await invoicesOf(client.id)).toHaveLength(2);
  });

  it('E2E-010 an owner with five students already linked activates them all: the first fees are issued and the expected amount rises', async () => {
    const g = await gym('e2e010');
    const linkedStudents = [] as Client[];
    for (let i = 0; i < 5; i += 1) {
      const { client } = await student(g);
      await h.linkStudentToPlan(client.id, g.plan);
      linkedStudents.push(client);
    }
    const before = await h.summary(g.owner);

    const eligible = await h.get(
      g.owner,
      'get',
      '/academia/students/billing/eligible',
    );
    const activated = await h
      .get(g.owner, 'post', '/academia/students/billing/activate')
      .send({
        items: eligible.body.map((e: { clientId: string }) => ({
          clientId: e.clientId,
          dueDay: 20,
        })),
      });
    const after = await h.summary(g.owner);

    expect(eligible.body).toHaveLength(5);
    expect(activated.body.activated).toHaveLength(5);
    expect(activated.body.skipped).toEqual([]);
    expect(
      await h.prisma.invoice.count({
        where: { clientId: { in: linkedStudents.map((c) => c.id) } },
      }),
    ).toBe(5);
    expect(before.body.current.expectedCents).toBe(0);
    expect(after.body.current.expectedCents).toBe(5 * 14990);
    expect(
      (await h.get(g.owner, 'get', '/academia/students/billing/eligible')).body,
    ).toEqual([]);
  });

  it('E2E-011 an employed educator cannot bill a student the gym bills; the gym panel is untouched and the educator’s panel holds no gym fee', async () => {
    const g = await gym('e2e011');
    const educator = await h.createUser(
      'e2e011-edu',
      h.products.premiumEducator,
    );
    await h.connectViaApi(educator, `${h.tag}-e2e011-edu-key`);
    await h.prisma.employment.create({
      data: {
        academiaId: g.academiaId,
        educatorId: educator.id,
        status: 'ACTIVE',
      },
    });
    const pupil = await h.createClient({
      academiaId: g.academiaId,
      professionalId: educator.id,
    });
    await h.storeTaxId(pupil.id);
    const linked = await link(g, pupil.id, {
      accessPlanId: g.plan.id,
      billing: { dueDay: 20 },
    });
    expect(linked.status).toBe(201);

    const refused = await h
      .get(educator, 'post', `/billing/students/${pupil.id}/invoices`)
      .send({
        competenceYear: 2026,
        competenceMonth: 11,
        amount: '100.00',
        dueDate: TODAY,
        cpfCnpj: '529.982.247-25',
      });
    const gymPanel = await h.summary(g.owner);
    const educatorPanel = await h.summary(educator);

    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('student_billed_by_gym');
    expect(gymPanel.body.current.expectedCents).toBe(14990);
    expect(educatorPanel.body.current.expectedCents).toBe(0);
    expect(await invoicesOf(pupil.id)).toHaveLength(1);
  });
});
