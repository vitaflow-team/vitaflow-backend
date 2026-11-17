/**
 * Integration and end-to-end tests for PRD `professional-financial-health-
 * dashboard`, task 1: a gym owner as billing owner (connect, refusals of
 * manual invoices, per-fee actions, the shared webhook) against a real
 * migrated database and the fake Asaas server. Gym fees are seeded directly:
 * issuing them belongs to the recurring-billing task.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { ReconciliationService } from '@/billing/reconciliation/reconciliation.service';
import { hashWebhookToken } from '@/billing/shared/credentials';
import { brasiliaDateKey } from '@/billing/shared/dates';
import { BillingAccountStatus, InvoiceStatus } from '@prisma/client';
import { FAKE_KEYS } from './support/fakeAsaasServer';
import { FinancialHealthHarness } from './support/financialHealthHarness';

jest.setTimeout(240_000);

const h = new FinancialHealthHarness(`finhealth-gym-${Date.now()}`);
const S = InvoiceStatus;

function realToday(): string {
  return brasiliaDateKey(new Date());
}

function addDays(key: string, days: number): string {
  return new Date(Date.parse(key) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function competence(key: string) {
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
}

// A connected gym (through the real route, so the webhook token exists) with
// one student, ready to receive seeded fees.
async function connectedGym(label: string) {
  const { owner, academiaId } = await h.createGymOwner(label);
  const apiKey = `${h.tag}-${label}-key`;
  const token = await h.connectViaApi(owner, apiKey);
  const account = await h.prisma.billingAccount.findFirstOrThrow({
    where: { userId: owner.id, status: BillingAccountStatus.ACTIVE },
  });
  return { owner, academiaId, account, token };
}

beforeAll(async () => {
  await h.start();
});

afterAll(async () => {
  await h.stop();
});

beforeEach(() => {
  h.now = new Date();
  h.sendNotificationEmail.mockClear();
});

describe('Gym billing account (IT-018, E2E-005)', () => {
  it('IT-018 a gym owner with an active subscription connects, never gets the key back, and a second connect leaves one active account', async () => {
    const { owner } = await h.createGymOwner('it018');
    const key = `${h.tag}-it018-key`;

    const first = await h
      .get(owner, 'put', '/billing/account')
      .send({ apiKey: key });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ connected: true, status: 'CONNECTED' });
    expect(JSON.stringify(first.body)).not.toContain(key);

    const hook = h.fake.requests
      .filter(
        (r) =>
          r.method === 'POST' &&
          r.path === '/webhooks' &&
          r.headers['access_token'] === key,
      )
      .at(-1)!;
    const rows = await h.prisma.billingAccount.findMany({
      where: { userId: owner.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].webhookTokenHash).toBe(
      hashWebhookToken(hook.body!.authToken as string),
    );

    const second = await h
      .get(owner, 'put', '/billing/account')
      .send({ apiKey: key });
    expect(second.status).toBe(200);
    const after = await h.prisma.billingAccount.findMany({
      where: { userId: owner.id },
    });
    expect(
      after.filter((a) => a.status === BillingAccountStatus.ACTIVE),
    ).toHaveLength(1);
    expect(
      after.filter((a) => a.status === BillingAccountStatus.REPLACED),
    ).toHaveLength(1);

    const read = await h.get(owner, 'get', '/billing/account');
    expect(read.body).toMatchObject({ connected: true, status: 'CONNECTED' });
    expect(JSON.stringify(read.body)).not.toContain(key);
  });

  it('IT-018 a refused key, a key held by another owner and a lapsed subscription are each refused with their own code', async () => {
    const { owner } = await h.createGymOwner('it018-refused');
    const refused = await h
      .get(owner, 'put', '/billing/account')
      .send({ apiKey: FAKE_KEYS.revoked });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('gateway_auth_failed');
    expect(
      await h.prisma.billingAccount.count({ where: { userId: owner.id } }),
    ).toBe(0);

    const holder = await connectedGym('it018-holder');
    const heldKey = `${h.tag}-it018-holder-key`;
    const clash = await h
      .get(owner, 'put', '/billing/account')
      .send({ apiKey: heldKey });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('account_key_in_use');
    expect(holder.account.status).toBe(BillingAccountStatus.ACTIVE);

    const { owner: lapsed } = await h.createGymOwner(
      'it018-lapsed',
      'canceled',
    );
    const requests = h.fake.requests.length;
    const blocked = await h
      .get(lapsed, 'put', '/billing/account')
      .send({ apiKey: `${h.tag}-it018-lapsed-key` });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('subscription_required');
    expect(h.fake.requests.length).toBe(requests);
  });

  it('IT-018 a student and a receptionist cannot use the billing account routes', async () => {
    const student = await h.createUser('it018-student', h.products.user);
    const { academiaId } = await h.createGymOwner('it018-staff');
    const receptionist = await h.prisma.academiaStaffMember.create({
      data: {
        academiaId,
        name: 'Recepcao',
        email: `${h.tag}-it018-recep@integration.test`,
        active: true,
      },
    });

    const asStudent = await h
      .get(student, 'put', '/billing/account')
      .send({ apiKey: `${h.tag}-it018-s-key` });
    const asReceptionist = await h
      .get(
        { id: receptionist.id, email: receptionist.email },
        'put',
        '/billing/account',
      )
      .send({ apiKey: `${h.tag}-it018-r-key` });

    expect(asStudent.status).toBe(403);
    expect(asStudent.body.code).toBe('not_billing_owner');
    expect(asReceptionist.status).toBe(401);
  });

  it('IT-039 a gym owner whose subscription lapses can no longer connect, but keeps reading the panel', async () => {
    const gym = await connectedGym('it039');
    const student = await h.createClient({ academiaId: gym.academiaId });
    await h.seedGymFee({
      account: gym.account,
      clientId: student.id,
      competence: competence(realToday()),
      amountCents: 12000,
      dueDate: realToday(),
    });
    await h.prisma.users.update({
      where: { id: gym.owner.id },
      data: { subscriptionStatus: 'canceled' },
    });

    const connect = await h
      .get(gym.owner, 'put', '/billing/account')
      .send({ apiKey: `${h.tag}-it039-new-key` });
    const summary = await h.summary(gym.owner);

    expect(connect.status).toBe(403);
    expect(connect.body.code).toBe('subscription_required');
    expect(summary.status).toBe(200);
    expect(summary.body.current.expectedCents).toBe(12000);
  });

  it('E2E-005 a gym owner starts not connected, connects, and sees an empty connected panel', async () => {
    const { owner } = await h.createGymOwner('e2e005');

    const before = await h.get(owner, 'get', '/billing/account');
    expect(before.body).toMatchObject({
      connected: false,
      status: 'NOT_CONNECTED',
    });
    const panelBefore = await h.summary(owner);
    expect(panelBefore.body).toMatchObject({
      audience: 'GYM',
      billingState: 'NOT_CONNECTED',
      hasHistory: false,
    });

    await h.connectViaApi(owner, `${h.tag}-e2e005-key`);
    const panel = await h.summary(owner);

    expect(panel.body).toMatchObject({
      audience: 'GYM',
      billingState: 'CONNECTED',
      hasHistory: false,
      current: { expectedCents: 0, receivedCents: 0, stillOwedCents: 0 },
      overdue: { totalCents: 0, delinquentCount: 0 },
    });
  });
});

describe('Manual invoices are refused for gyms and for gym students (IT-028, E2E-011)', () => {
  const body = () => ({
    competenceYear: Number(realToday().slice(0, 4)),
    competenceMonth: Number(realToday().slice(5, 7)),
    amount: '100.00',
    dueDate: realToday(),
    cpfCnpj: '529.982.247-25',
  });

  it('IT-028 a gym owner can neither create nor edit an invoice, and nothing changes', async () => {
    const gym = await connectedGym('it028-gym');
    const student = await h.createClient({ academiaId: gym.academiaId });
    const fee = await h.seedGymFee({
      account: gym.account,
      clientId: student.id,
      competence: competence(realToday()),
      amountCents: 10000,
      dueDate: addDays(realToday(), 3),
    });
    const chargesBefore = h.fake.requests.filter(
      (r) => r.method === 'POST' && r.path === '/payments',
    ).length;

    const created = await h
      .get(gym.owner, 'post', `/billing/students/${student.id}/invoices`)
      .send(body());
    const edited = await h
      .get(gym.owner, 'patch', `/billing/invoices/${fee.id}`)
      .send({ amount: '250.00' });

    expect(created.status).toBe(403);
    expect(created.body.code).toBe('manual_invoice_not_allowed');
    expect(edited.status).toBe(403);
    expect(edited.body.code).toBe('manual_invoice_not_allowed');
    expect(
      await h.prisma.invoice.count({ where: { clientId: student.id } }),
    ).toBe(1);
    expect(
      (await h.prisma.invoice.findUniqueOrThrow({ where: { id: fee.id } }))
        .amountCents,
    ).toBe(10000);
    expect(
      h.fake.requests.filter(
        (r) => r.method === 'POST' && r.path === '/payments',
      ).length,
    ).toBe(chargesBefore);
  });

  it('IT-028 an educator cannot invoice a gym student but still invoices an independent one', async () => {
    const { academiaId } = await h.createGymOwner('it028-edu-gym');
    const educator = await h.createUser(
      'it028-edu',
      h.products.premiumEducator,
    );
    await h.connectViaApi(educator, `${h.tag}-it028-edu-key`);
    const gymStudent = await h.createClient({
      professionalId: educator.id,
      academiaId,
    });
    const independent = await h.createClient({ professionalId: educator.id });

    const refused = await h
      .get(educator, 'post', `/billing/students/${gymStudent.id}/invoices`)
      .send(body());
    const allowed = await h
      .get(educator, 'post', `/billing/students/${independent.id}/invoices`)
      .send(body());

    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('student_billed_by_gym');
    expect(
      await h.prisma.invoice.count({ where: { clientId: gymStudent.id } }),
    ).toBe(0);
    expect(allowed.status).toBe(201);
  });

  it('E2E-011 the educator’s refusal leaves the gym panel untouched and the educator’s panel without the gym fee', async () => {
    const gym = await connectedGym('e2e011-gym');
    const educator = await h.createUser(
      'e2e011-edu',
      h.products.premiumEducator,
    );
    await h.connectViaApi(educator, `${h.tag}-e2e011-edu-key`);
    await h.prisma.employment.create({
      data: {
        academiaId: gym.academiaId,
        educatorId: educator.id,
        status: 'ACTIVE',
      },
    });
    const student = await h.createClient({
      professionalId: educator.id,
      academiaId: gym.academiaId,
    });
    await h.seedGymFee({
      account: gym.account,
      clientId: student.id,
      competence: competence(realToday()),
      amountCents: 30000,
      dueDate: realToday(),
    });

    const refused = await h
      .get(educator, 'post', `/billing/students/${student.id}/invoices`)
      .send(body());
    const gymPanel = await h.summary(gym.owner);
    const educatorPanel = await h.summary(educator);

    expect(refused.status).toBe(403);
    expect(gymPanel.body.current.expectedCents).toBe(30000);
    expect(educatorPanel.body.current.expectedCents).toBe(0);
  });
});

describe('Per-fee actions of a gym owner (IT-029, IT-030, E2E-007)', () => {
  const overdueDue = () => addDays(realToday(), -10);

  it('IT-029 mark paid puts the fee in received and takes the student off the delinquent list', async () => {
    const gym = await connectedGym('it029-paid');
    const student = await h.createClient({
      academiaId: gym.academiaId,
      name: 'Devedor',
    });
    const fee = await h.seedGymFee({
      account: gym.account,
      clientId: student.id,
      competence: competence(overdueDue()),
      amountCents: 14990,
      dueDate: overdueDue(),
      status: S.PENDING,
    });
    expect((await h.delinquents(gym.owner)).body.items).toHaveLength(1);

    const paid = await h
      .get(gym.owner, 'post', `/billing/invoices/${fee.id}/mark-paid`)
      .send({ paidOn: realToday() });

    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('PAID_MANUALLY');
    const summary = await h.summary(gym.owner);
    expect(summary.body.current.receivedCents).toBe(14990);
    expect(summary.body.overdue.delinquentCount).toBe(0);
    expect((await h.delinquents(gym.owner)).body.total).toBe(0);
  });

  it('IT-029 cancel excludes the fee from every figure', async () => {
    const gym = await connectedGym('it029-cancel');
    const student = await h.createClient({ academiaId: gym.academiaId });
    const fee = await h.seedGymFee({
      account: gym.account,
      clientId: student.id,
      competence: competence(overdueDue()),
      amountCents: 9000,
      dueDate: overdueDue(),
    });

    const canceled = await h
      .get(gym.owner, 'post', `/billing/invoices/${fee.id}/cancel`)
      .send();

    expect(canceled.status).toBe(200);
    expect(canceled.body.status).toBe('CANCELED');
    const summary = await h.summary(gym.owner);
    expect(summary.body.overdue.totalCents).toBe(0);
    expect(summary.body.current.expectedCents).toBe(0);
  });

  it('IT-029 resend mails the payment link and a second resend within an hour is 429', async () => {
    const gym = await connectedGym('it029-resend');
    const student = await h.createClient({ academiaId: gym.academiaId });
    const fee = await h.seedGymFee({
      account: gym.account,
      clientId: student.id,
      competence: competence(realToday()),
      amountCents: 9000,
      dueDate: addDays(realToday(), 2),
    });
    await h.prisma.invoice.update({
      where: { id: fee.id },
      data: { paymentUrl: 'https://sandbox.asaas.test/i/seed' },
    });

    const first = await h
      .get(gym.owner, 'post', `/billing/invoices/${fee.id}/resend`)
      .send();
    const second = await h
      .get(gym.owner, 'post', `/billing/invoices/${fee.id}/resend`)
      .send();

    expect(first.status).toBe(204);
    expect(h.sendNotificationEmail).toHaveBeenCalledTimes(1);
    expect(second.status).toBe(429);
    expect(second.body.code).toBe('resend_too_soon');
  });

  it('IT-029 another gym’s owner gets 404 on the fee and its student', async () => {
    const gym = await connectedGym('it029-own');
    const other = await connectedGym('it029-other');
    const student = await h.createClient({ academiaId: gym.academiaId });
    const fee = await h.seedGymFee({
      account: gym.account,
      clientId: student.id,
      competence: competence(realToday()),
      amountCents: 9000,
      dueDate: addDays(realToday(), 2),
    });

    for (const [method, path, payload] of [
      [
        'post',
        `/billing/invoices/${fee.id}/mark-paid`,
        { paidOn: realToday() },
      ],
      ['post', `/billing/invoices/${fee.id}/cancel`, {}],
      ['post', `/billing/invoices/${fee.id}/resend`, {}],
    ] as const) {
      const response = await h.get(other.owner, method, path).send(payload);
      expect(response.status).toBe(404);
    }
    expect(
      (
        await h.get(
          other.owner,
          'get',
          `/billing/students/${student.id}/invoices`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await h.prisma.invoice.findUniqueOrThrow({ where: { id: fee.id } }))
        .status,
    ).toBe(S.PENDING);
  });

  it('IT-029 a fee already paid at the gateway answers 409 and becomes PAID', async () => {
    const gym = await connectedGym('it029-gateway');
    const student = await h.createClient({ academiaId: gym.academiaId });
    const fee = await h.seedGymFee({
      account: gym.account,
      clientId: student.id,
      competence: competence(overdueDue()),
      amountCents: 7000,
      dueDate: overdueDue(),
    });
    h.fake.setChargeStatus(fee.externalId!, 'RECEIVED', realToday());

    const response = await h
      .get(gym.owner, 'post', `/billing/invoices/${fee.id}/mark-paid`)
      .send({ paidOn: realToday() });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('invoice_already_paid');
    expect(
      (await h.prisma.invoice.findUniqueOrThrow({ where: { id: fee.id } }))
        .status,
    ).toBe(S.PAID);
  });

  it('IT-029 with the gateway key refused, mark paid still works and resend asks to reconnect', async () => {
    const gym = await connectedGym('it029-refused');
    const student = await h.createClient({ academiaId: gym.academiaId });
    const fee = await h.seedGymFee({
      account: gym.account,
      clientId: student.id,
      competence: competence(overdueDue()),
      amountCents: 6000,
      dueDate: overdueDue(),
    });
    await h.prisma.invoice.update({
      where: { id: fee.id },
      data: { paymentUrl: 'https://sandbox.asaas.test/i/seed2' },
    });
    await h.prisma.billingAccount.update({
      where: { id: gym.account.id },
      data: { keyInvalidAt: new Date() },
    });

    const resend = await h
      .get(gym.owner, 'post', `/billing/invoices/${fee.id}/resend`)
      .send();
    const paid = await h
      .get(gym.owner, 'post', `/billing/invoices/${fee.id}/mark-paid`)
      .send({ paidOn: realToday() });

    expect(resend.status).toBe(409);
    expect(resend.body.code).toBe('billing_reconnect_needed');
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('PAID_MANUALLY');
  });

  it('IT-029 an owner sets the tax id of its own students only', async () => {
    const gym = await connectedGym('it029-tax');
    const other = await connectedGym('it029-tax-other');
    const own = await h.createClient({ academiaId: gym.academiaId });
    const foreign = await h.createClient({ academiaId: other.academiaId });

    const ok = await h
      .get(gym.owner, 'put', `/billing/students/${own.id}/tax-id`)
      .send({ cpfCnpj: '529.982.247-25' });
    const missing = await h
      .get(gym.owner, 'put', `/billing/students/${foreign.id}/tax-id`)
      .send({ cpfCnpj: '529.982.247-25' });

    expect(ok.status).toBe(200);
    expect(ok.body.present).toBe(true);
    expect(missing.status).toBe(404);
  });

  it('IT-030 the shared webhook pays a gym fee once: received rises, the delinquent row goes, the owner is notified once', async () => {
    const gym = await connectedGym('it030');
    const student = await h.createClient({
      academiaId: gym.academiaId,
      name: 'Pagante',
    });
    const today = realToday();
    const fee = await h.seedGymFee({
      account: gym.account,
      clientId: student.id,
      competence: competence(overdueDue()),
      amountCents: 20000,
      dueDate: overdueDue(),
    });
    expect((await h.delinquents(gym.owner)).body.total).toBe(1);
    h.fake.setChargeStatus(fee.externalId!, 'RECEIVED', today);

    const first = await h.notice(fee.externalId!, gym.token);
    const second = await h.notice(fee.externalId!, gym.token);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const stored = await h.prisma.invoice.findUniqueOrThrow({
      where: { id: fee.id },
    });
    expect(stored.status).toBe(S.PAID);
    expect(
      brasiliaDateKey(new Date(stored.paidAt!.getTime() + 3 * 3_600_000)),
    ).toBe(today);
    const summary = await h.summary(gym.owner);
    expect(summary.body.current.receivedCents).toBe(20000);
    expect((await h.delinquents(gym.owner)).body.total).toBe(0);
    expect(
      await h.prisma.notification.count({
        where: { userId: gym.owner.id, category: 'BILLING' },
      }),
    ).toBe(1);
  });

  it('E2E-007 a backdated gym fee puts the student on the list; marking it paid takes them off', async () => {
    const gym = await connectedGym('e2e007');
    const student = await h.createClient({
      academiaId: gym.academiaId,
      name: 'Atrasado',
    });
    const fee = await h.seedGymFee({
      account: gym.account,
      clientId: student.id,
      competence: competence(overdueDue()),
      amountCents: 18000,
      dueDate: overdueDue(),
    });

    const listed = await h.delinquents(gym.owner);
    expect(listed.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Atrasado',
    ]);
    expect(listed.body.items[0]).toMatchObject({
      totalOwedCents: 18000,
      overdueCount: 1,
      oldestDaysOverdue: 10,
    });

    const paid = await h
      .get(gym.owner, 'post', `/billing/invoices/${fee.id}/mark-paid`)
      .send({ paidOn: realToday() });
    expect(paid.status).toBe(200);
    expect((await h.delinquents(gym.owner)).body.items).toEqual([]);
  });
});

describe('Gym accounts on the nightly reconciliation (task 1.8)', () => {
  it('reconciliation heals a gym fee the webhook missed and turns a late pending fee overdue, like any professional account', async () => {
    const gym = await connectedGym('reconcile');
    const student = await h.createClient({ academiaId: gym.academiaId });
    const late = await h.createClient({ academiaId: gym.academiaId });
    const today = realToday();
    const missed = await h.seedGymFee({
      account: gym.account,
      clientId: student.id,
      competence: competence(addDays(today, -20)),
      amountCents: 11000,
      dueDate: addDays(today, -20),
    });
    const stale = await h.seedGymFee({
      account: gym.account,
      clientId: late.id,
      competence: competence(addDays(today, -5)),
      amountCents: 9000,
      dueDate: addDays(today, -5),
    });
    h.fake.setChargeStatus(missed.externalId!, 'RECEIVED', addDays(today, -1));

    await h.app.get(ReconciliationService, { strict: false }).run();

    const healed = await h.prisma.invoice.findUniqueOrThrow({
      where: { id: missed.id },
    });
    const overdue = await h.prisma.invoice.findUniqueOrThrow({
      where: { id: stale.id },
    });
    expect(healed.status).toBe(S.PAID);
    expect(overdue.status).toBe(S.OVERDUE);
    const delinquents = await h.delinquents(gym.owner);
    expect(
      delinquents.body.items.map((i: { clientId: string }) => i.clientId),
    ).toEqual([late.id]);
  });
});

describe('Financial-health migration (task 1.1)', () => {
  async function billingFor(clientId: string, overrides: object = {}) {
    return await h.prisma.gymRecurringBilling.create({
      data: {
        clientId,
        accessPlanId: `${h.tag}-plan`,
        dueDay: 10,
        amountCents: 14990,
        ...overrides,
      },
    });
  }

  it('allows one ACTIVE recurring billing per client, any number of ENDED ones', async () => {
    const { academiaId } = await h.createGymOwner('schema-unique');
    const client = await h.createClient({ academiaId });
    await billingFor(client.id, { status: 'ENDED', endedAt: new Date() });
    await billingFor(client.id, { status: 'ENDED', endedAt: new Date() });
    await billingFor(client.id);

    await expect(billingFor(client.id)).rejects.toThrow();
    expect(
      await h.prisma.gymRecurringBilling.count({
        where: { clientId: client.id },
      }),
    ).toBe(3);
  });

  it('refuses a due day outside 1 to 28 and a non-positive amount, and accepts the bounds', async () => {
    const { academiaId } = await h.createGymOwner('schema-check');
    const client = await h.createClient({ academiaId });

    for (const bad of [
      { dueDay: 0 },
      { dueDay: 29 },
      { amountCents: 0 },
      { amountCents: -1 },
    ]) {
      await expect(
        billingFor(client.id, { status: 'ENDED', ...bad }),
      ).rejects.toThrow();
    }
    await expect(
      billingFor(client.id, { status: 'ENDED', dueDay: 1, amountCents: 1 }),
    ).resolves.toBeDefined();
    await expect(
      billingFor(client.id, { status: 'ENDED', dueDay: 28 }),
    ).resolves.toBeDefined();
  });

  it('links an invoice to its recurring billing and keeps the invoice when the billing goes', async () => {
    const gym = await connectedGym('schema-link');
    const client = await h.createClient({ academiaId: gym.academiaId });
    const billing = await billingFor(client.id);
    const fee = await h.seedGymFee({
      account: gym.account,
      clientId: client.id,
      competence: competence(realToday()),
      amountCents: 14990,
      dueDate: realToday(),
    });
    await h.prisma.invoice.update({
      where: { id: fee.id },
      data: { recurringBillingId: billing.id },
    });

    await h.prisma.gymRecurringBilling.delete({ where: { id: billing.id } });

    const kept = await h.prisma.invoice.findUniqueOrThrow({
      where: { id: fee.id },
    });
    expect(kept.recurringBillingId).toBeNull();
  });

  it('creates the panel indexes on Invoice', async () => {
    const rows = await h.prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'Invoice'`;
    expect(rows.map((r) => r.indexname)).toEqual(
      expect.arrayContaining([
        'Invoice_billingAccountId_dueDate_idx',
        'Invoice_billingAccountId_paidAt_idx',
        'Invoice_recurringBillingId_idx',
      ]),
    );
  });
});
