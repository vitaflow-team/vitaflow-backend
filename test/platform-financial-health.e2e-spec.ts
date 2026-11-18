/**
 * Integration and end-to-end tests for PRD `professional-financial-health-
 * dashboard`, task 3: the Vitaflow team's view of its own subscription revenue.
 * They run the real Users (platform webhook), Backoffice and Billing modules
 * against a migrated database and the fake Asaas server; only the gateway, the
 * mailer and the clock are replaced.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { RecurringFeeIssuer } from '@/academia/billing/recurringFeeIssuer.service';
import { BackofficeModule } from '@/backoffice/backoffice.module';
import { BackofficeAccessLogRepository } from '@/repositories/backoffice/backofficeAccessLog.repository';
import { PlatformPaymentSync } from '@/users/subscription/platformPayments/platformPaymentSync.service';
import { UsersModule } from '@/users/users.module';
import {
  BackofficeTier,
  PlatformPaymentStatus,
  Prisma,
  ProductType,
  Users,
} from '@prisma/client';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import request from 'supertest';
import {
  FinancialHealthHarness,
  PLATFORM_API_KEY,
  JWT_SECRET,
  PLATFORM_WEBHOOK_TOKEN,
} from './support/financialHealthHarness';

jest.setTimeout(600_000);

const run = promisify(execFile);
const h = new FinancialHealthHarness(`platfin-${Date.now()}`, [
  UsersModule,
  BackofficeModule,
]);
const TODAY_ISO = '2026-11-17T15:00:00Z'; // 12:00 in Brasília
const S = PlatformPaymentStatus;
const SUMMARY = '/backoffice/financial-health/summary';
const DELINQUENTS = '/backoffice/financial-health/delinquents';

let admin: Users;
let equipe: Users;
let outsider: Users;
let sequence = 0;

beforeAll(async () => {
  await h.start();
  admin = await h.createStaff('admin', BackofficeTier.ADMIN);
  equipe = await h.createStaff('equipe', BackofficeTier.EQUIPE);
  outsider = await h.createUser('outsider', h.products.user);
});

afterAll(async () => {
  await h.stop();
});

beforeEach(() => {
  h.setNow(TODAY_ISO);
  h.fake.requests.length = 0;
});

// The panel reads the whole table, so every case starts and ends with none of
// its own rows (and a clean fake gateway) behind it.
afterEach(async () => {
  h.fake.setDown(false);
  h.fake.clearListingFailures();
  h.fake.charges.clear();
  await h.prisma.platformPayment.deleteMany({
    where: { user: { email: { startsWith: h.tag } } },
  });
  await h.prisma.gymRecurringBilling.deleteMany({
    where: { client: { email: { startsWith: h.tag } } },
  });
  await h.prisma.backofficeAccessLog.deleteMany({
    where: { staffUserId: { in: [admin.id, equipe.id] } },
  });
});

// --- Helpers ---

async function subscriber(
  label: string,
  productId = h.products.user,
  subscriptionStatus: string | null = 'active',
): Promise<Users> {
  sequence += 1;
  return await h.createUser(label, productId, {
    asaasCustomerId: `cus_${h.tag}_${label}_${sequence}`,
    subscriptionStatus,
  });
}

function gatewayPayment(
  user: Users,
  input: {
    valueCents: number;
    dueDate: string;
    status?: string;
    paymentDate?: string;
  },
): string {
  return h.fake.addPayment({
    customer: user.asaasCustomerId!,
    subscription: `sub_${user.asaasCustomerId}`,
    ...input,
  });
}

function notice(
  event: string,
  paymentId: string,
  user: Users,
  token: string | undefined = PLATFORM_WEBHOOK_TOKEN,
) {
  const call = request(h.server())
    .post('/users/subscription/webhook')
    .send({
      event,
      payment: {
        id: paymentId,
        customer: user.asaasCustomerId,
        subscription: `sub_${user.asaasCustomerId}`,
      },
    });
  return token === undefined ? call : call.set('asaas-access-token', token);
}

async function rowsOf(user: Users) {
  return await h.prisma.platformPayment.findMany({
    where: { userId: user.id },
    orderBy: { dueDate: 'asc' },
  });
}

function asStaff(user: Users, path: string) {
  return h.get(user, 'get', path);
}

async function seedPayment(
  user: Users,
  input: {
    valueCents: number;
    status: PlatformPaymentStatus;
    dueDate: string;
    paidAt?: string;
    productType?: ProductType;
  },
) {
  sequence += 1;
  return await h.prisma.platformPayment.create({
    data: {
      asaasPaymentId: `seed_${h.tag}_${sequence}`,
      userId: user.id,
      asaasCustomerId: user.asaasCustomerId ?? `cus_${h.tag}_seed`,
      productType: input.productType ?? ProductType.USER,
      productName: 'Plano de teste',
      valueCents: input.valueCents,
      status: input.status,
      dueDate: new Date(input.dueDate),
      paidAt: input.paidAt ? new Date(input.paidAt) : null,
      paidAmountCents: input.status === S.PAID ? input.valueCents : null,
    },
  });
}

function withoutSyncedAt<T extends { syncedAt?: unknown }>(body: T) {
  const { syncedAt: _syncedAt, ...rest } = body;
  void _syncedAt;
  return rest;
}

const ZERO = { expectedCents: 0, receivedCents: 0, stillOwedCents: 0 };

describe('Webhook to panel (IT-033)', () => {
  it('IT-033 payment notices write the rows, the panel follows them, duplicates change nothing and a payment moves the user in and out of the list', async () => {
    const paying = await subscriber('paying');
    const late = await subscriber('late');

    // PAYMENT_CREATED: a pending payment, re-read from the fake with the platform key.
    const first = gatewayPayment(paying, {
      valueCents: 14990,
      dueDate: '2026-11-05',
    });
    expect((await notice('PAYMENT_CREATED', first, paying)).status).toBe(200);
    expect(h.fake.requests).toContainEqual(
      expect.objectContaining({
        method: 'GET',
        path: `/payments/${first}`,
        headers: expect.objectContaining({
          access_token: PLATFORM_API_KEY,
        }) as unknown,
      }),
    );
    const pending = await asStaff(admin, `${SUMMARY}?month=2026-11`);
    expect(pending.body.byAccountType.USER).toEqual({
      expectedCents: 14990,
      receivedCents: 0,
      stillOwedCents: 14990,
    });

    // PAYMENT_RECEIVED: the same payment is now paid.
    h.fake.setChargeStatus(first, 'RECEIVED', '2026-11-06');
    expect((await notice('PAYMENT_RECEIVED', first, paying)).status).toBe(200);
    const paid = await asStaff(admin, `${SUMMARY}?month=2026-11`);
    expect(paid.body.byAccountType.USER).toEqual({
      expectedCents: 14990,
      receivedCents: 14990,
      stillOwedCents: 0,
    });
    expect(paid.body.overdue.delinquentCount).toBe(0);
    expect((await rowsOf(paying))[0]).toMatchObject({
      status: S.PAID,
      valueCents: 14990,
      paidAmountCents: 14990,
    });

    // PAYMENT_OVERDUE: the user turns past_due AND appears in the list.
    const second = gatewayPayment(late, {
      valueCents: 9990,
      dueDate: '2026-11-10',
    });
    await notice('PAYMENT_CREATED', second, late);
    h.fake.setChargeStatus(second, 'OVERDUE');
    expect((await notice('PAYMENT_OVERDUE', second, late)).status).toBe(200);
    expect(
      (await h.prisma.users.findUniqueOrThrow({ where: { id: late.id } }))
        .subscriptionStatus,
    ).toBe('past_due');
    const list = await asStaff(admin, `${DELINQUENTS}?page=1`);
    expect(list.body.items).toEqual([
      expect.objectContaining({
        userId: late.id,
        accountType: ProductType.USER,
        totalOwedCents: 9990,
        oldestDaysOverdue: 7,
      }),
    ]);

    // Duplicate notices change nothing.
    const before = await asStaff(admin, `${SUMMARY}?month=2026-11`);
    await notice('PAYMENT_OVERDUE', second, late);
    await notice('PAYMENT_OVERDUE', second, late);
    await notice('PAYMENT_RECEIVED', first, paying);
    const after = await asStaff(admin, `${SUMMARY}?month=2026-11`);
    expect(await rowsOf(late)).toHaveLength(1);
    expect(await rowsOf(paying)).toHaveLength(1);
    expect(withoutSyncedAt(after.body)).toEqual(withoutSyncedAt(before.body));
    expect(after.body.overdue.bands.d1to7Cents).toBe(9990);

    // A later PAYMENT_RECEIVED takes the user out of the list.
    h.fake.setChargeStatus(second, 'RECEIVED', '2026-11-17');
    await notice('PAYMENT_RECEIVED', second, late);
    const cleared = await asStaff(admin, `${DELINQUENTS}?page=1`);
    expect(cleared.body.items).toEqual([]);
    expect(cleared.body.total).toBe(0);
  });

  it('IT-033 refuses a notice with the wrong token and answers 503, writing nothing, when the gateway cannot be re-read', async () => {
    const user = await subscriber('reread');
    const id = gatewayPayment(user, {
      valueCents: 5000,
      dueDate: '2026-11-20',
    });

    const wrongToken = await notice('PAYMENT_CREATED', id, user, 'wrong-token');
    h.fake.setDown(true);
    const down = await notice('PAYMENT_CREATED', id, user);
    h.fake.setDown(false);

    expect(wrongToken.status).toBe(401);
    expect(down.status).toBe(503);
    expect(down.body.code).toBe('platform_payment_reread_failed');
    expect(await rowsOf(user)).toHaveLength(0);
    expect((await notice('PAYMENT_CREATED', id, user)).status).toBe(200);
    expect(await rowsOf(user)).toHaveLength(1);
  });

  it('IT-033 a removed payment becomes CANCELED and leaves every figure', async () => {
    const user = await subscriber('removed');
    const id = gatewayPayment(user, {
      valueCents: 7000,
      dueDate: '2026-11-03',
    });
    await notice('PAYMENT_CREATED', id, user);
    h.fake.deletePayment(id);

    const deleted = await notice('PAYMENT_DELETED', id, user);
    const unknown = await notice('PAYMENT_DELETED', 'pay_never_seen', user);

    expect(deleted.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect((await rowsOf(user))[0].status).toBe(S.CANCELED);
    const summary = await asStaff(admin, `${SUMMARY}?month=2026-11`);
    expect(summary.body.totals).toEqual(ZERO);
    expect(summary.body.overdue.totalCents).toBe(0);
  });

  it('UT-115 to UT-118, UT-125 and UT-129 hold on the real table: both payments of a plan change count, refunded and canceled ones never do, past-due pending is overdue, a deleted user vanishes and a canceled subscription stays overdue until paid', async () => {
    const changed = await subscriber('changed');
    const refunded = await subscriber('refunded');
    const canceledSubscription = await subscriber(
      'canceledsub',
      h.products.user,
      'canceled',
    );
    const pastDue = await subscriber('pastdue', h.products.user, 'past_due');
    const gone = await subscriber('gone');
    await seedPayment(changed, {
      valueCents: 9990,
      status: S.PAID,
      dueDate: '2026-11-02',
      paidAt: '2026-11-02',
    });
    await seedPayment(changed, {
      valueCents: 14990,
      status: S.PENDING,
      dueDate: '2026-11-20',
    });
    await seedPayment(refunded, {
      valueCents: 5000,
      status: S.REFUNDED,
      dueDate: '2026-11-05',
      paidAt: '2026-11-05',
    });
    await seedPayment(refunded, {
      valueCents: 6000,
      status: S.CANCELED,
      dueDate: '2026-10-01',
    });
    await seedPayment(canceledSubscription, {
      valueCents: 2000,
      status: S.OVERDUE,
      dueDate: '2026-11-01',
    });
    await seedPayment(pastDue, {
      valueCents: 3000,
      status: S.PENDING,
      dueDate: '2026-11-16',
    });
    await seedPayment(pastDue, {
      valueCents: 4000,
      status: S.PENDING,
      dueDate: '2026-11-17',
    });
    await seedPayment(gone, {
      valueCents: 8000,
      status: S.OVERDUE,
      dueDate: '2026-11-01',
    });

    const withGone = await asStaff(admin, `${SUMMARY}?month=2026-11`);
    expect(withGone.body.overdue.totalCents).toBe(2000 + 3000 + 8000);
    expect(withGone.body.overdue.delinquentCount).toBe(3);

    await h.prisma.users.delete({ where: { id: gone.id } });
    const summary = await asStaff(admin, `${SUMMARY}?month=2026-11`);
    const list = await asStaff(admin, `${DELINQUENTS}?page=1`);

    expect(summary.body.totals).toEqual({
      expectedCents: 9990 + 14990 + 2000 + 3000 + 4000,
      receivedCents: 9990,
      stillOwedCents: 14990 + 2000 + 3000 + 4000,
    });
    expect(summary.body.overdue).toMatchObject({
      totalCents: 5000,
      delinquentCount: 2,
      bands: { d1to7Cents: 3000, d8to30Cents: 2000, d31PlusCents: 0 },
    });
    expect(list.body.items.map((i: { userId: string }) => i.userId)).toEqual([
      pastDue.id,
      canceledSubscription.id,
    ]);
    expect(list.body.total).toBe(2);
  });
});

describe('Backfill and nightly sync (IT-034)', () => {
  function seedGateway(
    owners: Users[],
    count: number,
    unknownEvery: number | null,
  ): number {
    let known = 0;
    for (let i = 0; i < count; i += 1) {
      const month = 10 + (i % 14); // 14 months: 2025-10 .. 2026-11
      const year = 2025 + Math.floor((month - 1) / 12);
      const monthOfYear = ((month - 1) % 12) + 1;
      const isUnknown = unknownEvery !== null && i % unknownEvery === 0;
      if (!isUnknown) known += 1;
      h.fake.addPayment({
        customer: isUnknown
          ? `cus_${h.tag}_nobody`
          : owners[i % owners.length].asaasCustomerId!,
        subscription: `sub_${h.tag}`,
        valueCents: 1000 + i,
        dueDate: `${year}-${String(monthOfYear).padStart(2, '0')}-10`,
        status: i % 3 === 0 ? 'RECEIVED' : 'PENDING',
        paymentDate:
          i % 3 === 0
            ? `${year}-${String(monthOfYear).padStart(2, '0')}-11`
            : undefined,
      });
    }
    return known;
  }

  it('IT-034 the backfill script loads the whole history across 14 months, skips unknown customers and a second run adds no row', async () => {
    const owners = [
      await subscriber('bf1'),
      await subscriber('bf2'),
      await subscriber('bf3'),
    ];
    const known = seedGateway(owners, 237, 8);
    const countRows = () =>
      h.prisma.platformPayment.count({
        where: { user: { email: { startsWith: h.tag } } },
      });
    const script = async () =>
      await run(
        process.execPath,
        [
          require.resolve('ts-node/dist/bin.js'),
          '-r',
          'tsconfig-paths/register',
          'scripts/backfillPlatformPayments/main.ts',
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            TS_NODE_TRANSPILE_ONLY: 'true',
            ASAAS_PLATFORM_API_KEY: PLATFORM_API_KEY,
            ASAAS_BASE_URL: h.fake.baseUrl,
          },
        },
      );

    await script();
    const afterFirst = await countRows();
    const snapshot = await h.prisma.platformPayment.findMany({
      where: { user: { email: { startsWith: h.tag } } },
      orderBy: { asaasPaymentId: 'asc' },
      select: { asaasPaymentId: true, status: true, valueCents: true },
    });
    await script();

    expect(afterFirst).toBe(known);
    expect(known).toBe(237 - Math.ceil(237 / 8));
    expect(await countRows()).toBe(known);
    expect(
      await h.prisma.platformPayment.findMany({
        where: { user: { email: { startsWith: h.tag } } },
        orderBy: { asaasPaymentId: 'asc' },
        select: { asaasPaymentId: true, status: true, valueCents: true },
      }),
    ).toEqual(snapshot);
    const listings = h.fake.requests.filter(
      (r) => r.method === 'GET' && r.path.startsWith('/payments?'),
    );
    expect(listings).toHaveLength(6);
  });

  it('IT-034 the nightly sync heals a payment missing from the table, asks only for the rolling window and skips unknown customers', async () => {
    const user = await subscriber('nightly');
    const sync = h.app.get(PlatformPaymentSync, { strict: false });
    const inside = gatewayPayment(user, {
      valueCents: 12345,
      dueDate: '2026-11-20',
    });
    gatewayPayment(user, { valueCents: 999, dueDate: '2025-01-10' });
    h.fake.addPayment({
      customer: `cus_${h.tag}_stranger`,
      valueCents: 1111,
      dueDate: '2026-11-21',
    });

    const summary = await sync.run();

    expect(summary).toMatchObject({
      ok: true,
      fetched: 2,
      upserted: 1,
      skipped: 1,
    });
    const rows = await rowsOf(user);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      asaasPaymentId: inside,
      valueCents: 12345,
      status: S.PENDING,
    });
    const listing = h.fake.requests.find((r) =>
      r.path.startsWith('/payments?'),
    )!;
    const query = new URL(listing.path, 'http://fake.local').searchParams;
    expect(query.get('dueDate[ge]')).toBe('2026-09-18');
    expect(query.get('dueDate[le]')).toBe('2026-12-17');
  });

  it('IT-034 a gateway failure on the second page keeps the first page and removes nothing', async () => {
    const user = await subscriber('partial');
    seedGateway([user], 150, null);
    // The gateway client retries a read twice, so the second page keeps failing.
    h.fake.failNextListings(5, 500, 1);
    const sync = h.app.get(PlatformPaymentSync, { strict: false });

    const summary = await sync.backfill();

    expect(summary).toMatchObject({ ok: false, pages: 1, failedAtOffset: 100 });
    expect(await rowsOf(user)).toHaveLength(100);
  });
});

describe('Access matrix (IT-035, IT-036, IT-041, IT-042)', () => {
  it('IT-035 ADMIN reads both, EQUIPE only the list with its tier, a non-backoffice user nothing, and every list read leaves one log row with the tier and page', async () => {
    const user = await subscriber('matrix');
    await seedPayment(user, {
      valueCents: 5000,
      status: S.OVERDUE,
      dueDate: '2026-11-10',
    });

    const adminSummary = await asStaff(admin, SUMMARY);
    const adminList = await asStaff(admin, `${DELINQUENTS}?page=2`);
    const equipeSummary = await asStaff(equipe, SUMMARY);
    const equipeList = await asStaff(equipe, DELINQUENTS);
    const outsiderSummary = await asStaff(outsider, SUMMARY);
    const outsiderList = await asStaff(outsider, DELINQUENTS);

    expect(adminSummary.status).toBe(200);
    expect(adminList.status).toBe(200);
    expect(adminList.body.tier).toBe('ADMIN');
    expect(equipeSummary.status).toBe(403);
    expect(equipeSummary.body.message).toBe(
      'Acesso restrito a administradores internos.',
    );
    expect(equipeList.status).toBe(200);
    expect(equipeList.body.tier).toBe('EQUIPE');
    expect(equipeList.body.bandCounts).toEqual({
      d1to7: 1,
      d8to30: 0,
      d31Plus: 0,
    });
    expect(Object.keys(equipeList.body).sort()).toEqual([
      'bandCounts',
      'items',
      'page',
      'pageSize',
      'tier',
      'total',
    ]);
    expect(equipeList.body.items[0]).toEqual({
      userId: user.id,
      name: user.name,
      accountType: ProductType.USER,
      planName: 'Plano de teste',
      totalOwedCents: 5000,
      oldestDaysOverdue: 7,
    });
    expect(outsiderSummary.status).toBe(403);
    expect(outsiderSummary.body.message).toBe(
      'Acesso restrito à equipe Vita Flow.',
    );
    expect(outsiderList.status).toBe(403);
    expect(outsiderList.body.message).toBe(
      'Acesso restrito à equipe Vita Flow.',
    );

    const logs = await h.prisma.backofficeAccessLog.findMany({
      where: { staffUserId: { in: [admin.id, equipe.id, outsider.id] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(
      logs.map((l) => [l.staffUserId, l.tier, l.resource, l.page]),
    ).toEqual([
      [admin.id, 'ADMIN', 'FINANCIAL_DELINQUENT_LIST', 2],
      [equipe.id, 'EQUIPE', 'FINANCIAL_DELINQUENT_LIST', 1],
    ]);
  });

  it('IT-035 validates the month, never letting the team ask beyond the 12 months before the current one', async () => {
    const bad = await asStaff(admin, `${SUMMARY}?month=2026-13`);
    const future = await asStaff(admin, `${SUMMARY}?month=2026-12`);
    const tooOld = await asStaff(admin, `${SUMMARY}?month=2025-10`);

    for (const response of [bad, future, tooOld]) {
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('invalid_month');
    }
  });

  it('IT-036 refuses the list with 503 access_log_failed and no data while the log cannot be written, and serves it again once it can', async () => {
    const user = await subscriber('failclosed');
    await seedPayment(user, {
      valueCents: 5000,
      status: S.OVERDUE,
      dueDate: '2026-11-10',
    });
    const repository = h.app.get(BackofficeAccessLogRepository, {
      strict: false,
    });
    const fault = jest
      .spyOn(repository, 'create')
      .mockRejectedValue(new Error('insert failed'));

    const refused = await asStaff(equipe, DELINQUENTS);
    fault.mockRestore();
    const served = await asStaff(equipe, DELINQUENTS);

    expect(refused.status).toBe(503);
    expect(refused.body.code).toBe('access_log_failed');
    expect(refused.body).not.toHaveProperty('items');
    expect(refused.body).not.toHaveProperty('total');
    expect(served.status).toBe(200);
    expect(served.body.items).toHaveLength(1);
    expect(
      await h.prisma.backofficeAccessLog.count({
        where: { staffUserId: equipe.id },
      }),
    ).toBe(1);
  });

  // The session endpoint cannot mint a token the application then accepts (its
  // `exp` clashes with the module's `expiresIn`, and AuthGuard reads `id` and
  // `email`, which the token lacks), so the token is built the way AuthGuard
  // reads identity: the TARGET user, plus the "view as" claims of a real session.
  it('IT-042 a "view as" token of a non-backoffice user is refused by both backoffice routes and never lends a staff tier', async () => {
    const session = await h.prisma.backofficeViewAsSession.create({
      data: {
        staffUserId: admin.id,
        targetKind: 'USER',
        targetUserId: outsider.id,
        reason: 'Investigando chamado de suporte',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    const viewAs = `Bearer ${h.jwt.sign(
      {
        id: outsider.id,
        email: outsider.email,
        sub: outsider.id,
        targetKind: 'USER',
        actingStaffId: admin.id,
        viewAsSessionId: session.id,
      },
      { secret: JWT_SECRET },
    )}`;

    const summary = await request(h.server())
      .get(SUMMARY)
      .set('Authorization', viewAs);
    const list = await request(h.server())
      .get(DELINQUENTS)
      .set('Authorization', viewAs);

    expect(summary.status).toBe(403);
    expect(list.status).toBe(403);
    expect(
      await h.prisma.backofficeAccessLog.count({
        where: { staffUserId: { in: [admin.id, outsider.id] } },
      }),
    ).toBe(0);
  });

  it('IT-041 applies a tier change to the very next request with the same token', async () => {
    const staff = await h.createStaff('demoted', BackofficeTier.ADMIN);
    const first = await asStaff(staff, SUMMARY);

    await h.prisma.users.update({
      where: { id: staff.id },
      data: { backofficeTier: BackofficeTier.EQUIPE },
    });
    const second = await asStaff(staff, SUMMARY);
    const list = await asStaff(staff, DELINQUENTS);

    expect(first.status).toBe(200);
    expect(second.status).toBe(403);
    expect(second.body.message).toBe(
      'Acesso restrito a administradores internos.',
    );
    expect(list.body.tier).toBe('EQUIPE');
    await h.prisma.backofficeAccessLog.deleteMany({
      where: { staffUserId: staff.id },
    });
  });
});

describe('Scale (IT-037)', () => {
  it('IT-037 fifty thousand payments over five thousand users: exact totals and a first page within a second', async () => {
    const types = Object.values(ProductType);
    const users = Array.from({ length: 5000 }, (_, i) => ({
      name: `Assinante ${String(i).padStart(4, '0')}`,
      email: `${h.tag}-scale-${i}@integration.test`,
      password: 'unused-in-integration-test',
      active: true,
      productId: h.products.user,
    }));
    for (let i = 0; i < users.length; i += 1000) {
      await h.prisma.users.createMany({ data: users.slice(i, i + 1000) });
    }
    const ids = (
      await h.prisma.users.findMany({
        where: { email: { startsWith: `${h.tag}-scale-` } },
        select: { id: true, email: true },
      })
    ).sort(
      (a, b) =>
        Number(a.email.split('-scale-')[1].split('@')[0]) -
        Number(b.email.split('-scale-')[1].split('@')[0]),
    );
    const kinds: {
      due: string;
      status: PlatformPaymentStatus;
      paidAt?: string;
    }[] = [
      { due: '2026-11-02', status: S.PAID, paidAt: '2026-11-02' },
      { due: '2026-11-20', status: S.PENDING },
      { due: '2026-03-15', status: S.PAID, paidAt: '2026-03-15' },
      { due: '2026-04-15', status: S.PAID, paidAt: '2026-11-05' },
      { due: '2026-11-10', status: S.REFUNDED, paidAt: '2026-11-10' },
      { due: '2026-11-12', status: S.CANCELED },
      { due: '2026-10-28', status: S.OVERDUE },
      { due: '2026-08-15', status: S.PENDING },
      { due: '2026-11-12', status: S.PENDING },
      { due: '2026-10-31', status: S.PAID, paidAt: '2026-11-03' },
    ];
    const zero = () => ({
      ...ZERO,
      previous: { ...ZERO },
      d1: 0,
      d8: 0,
      d31: 0,
    });
    const expected: Record<string, ReturnType<typeof zero>> = {};
    for (const type of types) expected[type] = zero();
    const rows: Prisma.PlatformPaymentCreateManyInput[] = [];
    ids.forEach(({ id }, i) => {
      const type = types[i % types.length];
      kinds.forEach((kind, g) => {
        const value = 1000 + (i % 7) * 100 + g;
        rows.push({
          asaasPaymentId: `seed_${h.tag}_${i}_${g}`,
          userId: id,
          asaasCustomerId: `cus_${h.tag}_${i}`,
          productType: type,
          productName: `Plano ${type}`,
          valueCents: value,
          status: kind.status,
          dueDate: new Date(kind.due),
          paidAt: kind.paidAt ? new Date(kind.paidAt) : null,
          paidAmountCents: kind.status === S.PAID ? value : null,
        });
        const totals = expected[type];
        if (kind.status === S.REFUNDED || kind.status === S.CANCELED) return;
        const open = kind.status === S.PENDING || kind.status === S.OVERDUE;
        if (kind.due.startsWith('2026-11')) totals.expectedCents += value;
        if (kind.due.startsWith('2026-10'))
          totals.previous.expectedCents += value;
        if (kind.status === S.PAID && kind.paidAt!.startsWith('2026-11'))
          totals.receivedCents += value;
        if (open && kind.due.startsWith('2026-11'))
          totals.stillOwedCents += value;
        if (open && kind.due.startsWith('2026-10'))
          totals.previous.stillOwedCents += value;
        if (open && kind.due < '2026-11-17') {
          const days = Math.round(
            (Date.parse('2026-11-17') - Date.parse(kind.due)) / 86_400_000,
          );
          if (days <= 7) totals.d1 += value;
          else if (days <= 30) totals.d8 += value;
          else totals.d31 += value;
        }
      });
    });
    for (let i = 0; i < rows.length; i += 2500) {
      await h.prisma.platformPayment.createMany({
        data: rows.slice(i, i + 2500),
      });
    }

    // Warm the pool, then budget one second of work plus measured round trips.
    await asStaff(admin, `${SUMMARY}?month=2026-11`);
    const rttStarted = Date.now();
    await h.prisma.$queryRaw`SELECT 1`;
    const budgetMs = 1000 + 6 * (Date.now() - rttStarted);
    const summaryStarted = Date.now();
    const summary = await asStaff(admin, `${SUMMARY}?month=2026-11`);
    const summaryMs = Date.now() - summaryStarted;
    const listStarted = Date.now();
    const list = await asStaff(equipe, `${DELINQUENTS}?page=1`);
    const listMs = Date.now() - listStarted;

    expect(summaryMs).toBeLessThan(budgetMs);
    expect(listMs).toBeLessThan(budgetMs);
    const sum = (pick: (t: ReturnType<typeof zero>) => number) =>
      types.reduce((total, type) => total + pick(expected[type]), 0);
    expect(summary.body.totals).toEqual({
      expectedCents: sum((t) => t.expectedCents),
      receivedCents: sum((t) => t.receivedCents),
      stillOwedCents: sum((t) => t.stillOwedCents),
    });
    expect(summary.body.previous.totals).toEqual({
      expectedCents: sum((t) => t.previous.expectedCents),
      receivedCents: 0,
      stillOwedCents: sum((t) => t.previous.stillOwedCents),
    });
    for (const type of types) {
      expect(summary.body.byAccountType[type]).toEqual({
        expectedCents: expected[type].expectedCents,
        receivedCents: expected[type].receivedCents,
        stillOwedCents: expected[type].stillOwedCents,
      });
      expect(summary.body.overdue.byAccountType[type].bands).toEqual({
        d1to7Cents: expected[type].d1,
        d8to30Cents: expected[type].d8,
        d31PlusCents: expected[type].d31,
      });
    }
    expect(summary.body.overdue).toMatchObject({
      totalCents: sum((t) => t.d1 + t.d8 + t.d31),
      delinquentCount: 5000,
    });
    expect(list.body).toMatchObject({
      total: 5000,
      page: 1,
      pageSize: 20,
      bandCounts: { d1to7: 0, d8to30: 0, d31Plus: 5000 },
    });
    // Everyone owes the same kinds of payment; the amount differs by i % 7, so
    // the first page is the i % 7 === 6 users, by name.
    expect(
      list.body.items.map((item: { userId: string }) => item.userId),
    ).toEqual(
      ids
        .filter((_, i) => i % 7 === 6)
        .slice(0, 20)
        .map(({ id }) => id),
    );
    expect(list.body.items[0].totalOwedCents).toBe(3000 + 6 * 300 + 21);
    expect(JSON.stringify(summary.body)).not.toContain('asaasPaymentId');

    await h.prisma.platformPayment.deleteMany({
      where: { asaasPaymentId: { startsWith: `seed_${h.tag}_` } },
    });
  });
});

describe('Gateway outage (IT-043, E2E-015)', () => {
  async function connectedGym(label: string) {
    const { owner, academiaId } = await h.createGymOwner(label);
    const apiKey = `${h.tag}-${label}-key`;
    await h.connectViaApi(owner, apiKey);
    const plan = await h.createAccessPlan(academiaId, { priceReais: 149.9 });
    return { owner, academiaId, plan };
  }

  async function linkedStudent(gym: Awaited<ReturnType<typeof connectedGym>>) {
    const client = await h.createClient({ academiaId: gym.academiaId });
    await h.storeTaxId(client.id);
    const response = await h
      .get(gym.owner, 'post', `/academia/students/${client.id}/access-plan`)
      .send({ accessPlanId: gym.plan.id, billing: { dueDay: 17 } });
    expect(response.status).toBe(201);
    return client;
  }

  it('IT-043 the platform panel answers 200 with the last sync time while every gateway call fails, and never calls the gateway', async () => {
    const user = await subscriber('outage');
    const id = gatewayPayment(user, {
      valueCents: 14990,
      dueDate: '2026-11-05',
    });
    await notice('PAYMENT_CREATED', id, user);
    const late = await subscriber('outagelate');
    await seedPayment(late, {
      valueCents: 5000,
      status: S.OVERDUE,
      dueDate: '2026-11-10',
    });
    const educator = await h.createUser(
      'outageedu',
      h.products.premiumEducator,
    );
    await h.createAccount(educator);
    const gym = await h.createGymOwner('outagegym');
    await h.createAccount(gym.owner);
    const lastWrite = (
      await h.prisma.platformPayment.aggregate({ _max: { updatedAt: true } })
    )._max.updatedAt!;

    h.fake.requests.length = 0;
    h.fake.setDown(true);
    const sync = await h.app.get(PlatformPaymentSync, { strict: false }).run();
    const requestsAfterSync = h.fake.requests.length;
    const summary = await asStaff(admin, `${SUMMARY}?month=2026-11`);
    const list = await asStaff(equipe, DELINQUENTS);
    const professional = await h.summary(educator);
    const gymPanel = await h.summary(gym.owner);

    expect(sync.ok).toBe(false);
    expect(summary.status).toBe(200);
    expect(summary.body.syncedAt).toBe(lastWrite.toISOString());
    expect(summary.body.totals.expectedCents).toBe(14990 + 5000);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(professional.status).toBe(200);
    expect(gymPanel.status).toBe(200);
    // Only the failed sync reached for the gateway; the reads never did.
    expect(h.fake.requests).toHaveLength(requestsAfterSync);
    expect(h.fake.requests.every((r) => r.path.startsWith('/payments?'))).toBe(
      true,
    );
  });

  it('E2E-015 with every gateway call failing the panels still answer, and a gym fee failing for one student leaves the other student issued', async () => {
    const gym = await connectedGym('e2e15');
    const first = await linkedStudent(gym);
    const second = await linkedStudent(gym);
    const educator = await h.createUser('e2e15edu', h.products.premiumEducator);
    await h.createAccount(educator);

    h.fake.setDown(true);
    const outage = await Promise.all([
      asStaff(admin, `${SUMMARY}?month=2026-11`),
      asStaff(equipe, DELINQUENTS),
      h.summary(educator),
      h.summary(gym.owner),
      h.delinquents(gym.owner),
    ]);
    h.fake.setDown(false);

    expect(outage.map((response) => response.status)).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect(outage[2].body.audience).toBe('PROFESSIONAL');
    expect(outage[3].body.audience).toBe('GYM');

    // Back up, a month later: one charge fails, the other billing is issued.
    h.setNow('2026-12-10T15:00:00Z');
    h.fake.failNextCharges(1);
    const summary = await h.app
      .get(RecurringFeeIssuer, { strict: false })
      .run();
    h.fake.clearChargeFailures();

    expect(summary).toMatchObject({ issued: 1, failed: 1 });
    const december = await h.prisma.invoice.findMany({
      where: {
        clientId: { in: [first.id, second.id] },
        competenceYear: 2026,
        competenceMonth: 12,
      },
    });
    expect(december).toHaveLength(1);
  });
});

describe('Platform journeys (E2E-013, E2E-014)', () => {
  it('E2E-013 payment webhooks build the picture an ADMIN reads: current month, previous month, a month before any payment, and the overdue bands by account type', async () => {
    const student = await subscriber('j13student');
    const educator = await subscriber('j13edu', h.products.premiumEducator);
    const nutritionist = await subscriber(
      'j13nutri',
      h.products.premiumNutritionist,
    );
    const gym = await subscriber('j13gym', h.products.academia);
    const events: [Users, string, string, string?][] = [
      [educator, 'OVERDUE', '2026-11-12'],
      [nutritionist, 'OVERDUE', '2026-10-10'],
      [gym, 'PENDING', '2026-11-25'],
      [student, 'RECEIVED', '2026-11-03', '2026-11-03'],
      [educator, 'RECEIVED', '2026-10-12', '2026-10-14'],
    ];
    const values = [9990, 12990, 29990, 4990, 9990];
    for (const [i, [user, status, dueDate, paymentDate]] of events.entries()) {
      const id = gatewayPayment(user, {
        valueCents: values[i],
        dueDate,
        status,
        paymentDate,
      });
      expect((await notice('PAYMENT_UPDATED', id, user)).status).toBe(200);
    }

    const current = await asStaff(admin, `${SUMMARY}?month=2026-11`);
    const previous = await asStaff(admin, `${SUMMARY}?month=2026-10`);
    const unavailable = await asStaff(admin, `${SUMMARY}?month=2026-09`);

    expect(current.body).toMatchObject({
      month: '2026-11',
      available: true,
      totals: {
        expectedCents: 44970,
        receivedCents: 4990,
        stillOwedCents: 39980,
      },
      byAccountType: {
        USER: { expectedCents: 4990, receivedCents: 4990, stillOwedCents: 0 },
        PHYSICAL_EDUCATOR: {
          expectedCents: 9990,
          receivedCents: 0,
          stillOwedCents: 9990,
        },
        NUTRITIONIST: ZERO,
        ACADEMIA: {
          expectedCents: 29990,
          receivedCents: 0,
          stillOwedCents: 29990,
        },
      },
      previous: {
        month: '2026-10',
        totals: {
          expectedCents: 22980,
          receivedCents: 9990,
          stillOwedCents: 12990,
        },
      },
      overdue: {
        totalCents: 22980,
        delinquentCount: 2,
        bands: { d1to7Cents: 9990, d8to30Cents: 0, d31PlusCents: 12990 },
        byAccountType: {
          PHYSICAL_EDUCATOR: { totalCents: 9990, delinquentCount: 1 },
          NUTRITIONIST: { totalCents: 12990, delinquentCount: 1 },
          USER: { totalCents: 0, delinquentCount: 0 },
          ACADEMIA: { totalCents: 0, delinquentCount: 0 },
        },
      },
    });
    expect(current.body.syncedAt).toEqual(expect.any(String));
    expect(previous.body).toMatchObject({
      month: '2026-10',
      available: true,
      previous: null,
      totals: {
        expectedCents: 22980,
        receivedCents: 9990,
        stillOwedCents: 12990,
      },
    });
    expect(unavailable.body).toMatchObject({
      month: '2026-09',
      available: false,
      totals: null,
      byAccountType: null,
      previous: null,
    });
    expect(unavailable.body.overdue.totalCents).toBe(22980);
  });

  it('E2E-014 an EQUIPE member reads the delinquents with their tier and band counts, the summary is refused and the database holds the matching log rows', async () => {
    const late = await subscriber('j14late');
    const later = await subscriber('j14later');
    for (const [user, dueDate, value] of [
      [late, '2026-11-12', 8000],
      [later, '2026-09-01', 3000],
    ] as const) {
      const id = gatewayPayment(user, {
        valueCents: value,
        dueDate,
        status: 'OVERDUE',
      });
      await notice('PAYMENT_UPDATED', id, user);
    }

    const list = await asStaff(equipe, `${DELINQUENTS}?page=1`);
    const second = await asStaff(equipe, `${DELINQUENTS}?page=5`);
    const totals = await asStaff(equipe, SUMMARY);

    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({
      tier: 'EQUIPE',
      total: 2,
      page: 1,
      bandCounts: { d1to7: 1, d8to30: 0, d31Plus: 1 },
    });
    expect(
      list.body.items.map((item: { userId: string }) => item.userId),
    ).toEqual([late.id, later.id]);
    expect(second.body.page).toBe(1);
    expect(totals.status).toBe(403);
    const logs = await h.prisma.backofficeAccessLog.findMany({
      where: { staffUserId: equipe.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((l) => [l.tier, l.resource, l.page])).toEqual([
      ['EQUIPE', 'FINANCIAL_DELINQUENT_LIST', 1],
      ['EQUIPE', 'FINANCIAL_DELINQUENT_LIST', 5],
    ]);
  });
});
