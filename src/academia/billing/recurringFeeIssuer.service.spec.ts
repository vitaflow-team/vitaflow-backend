import { CodedError } from '@/common/errors/codedError';
import type { IssuableBilling } from '@/repositories/academia/types/issuableBilling';
import { sleep } from '@/utils/sleep';
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { RecurringFeeIssuer } from './recurringFeeIssuer.service';

jest.mock('@/utils/sleep', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

// The key the real @Cron decorator writes (the unit-test stub records it too).
const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

type IssueFn = (input: unknown) => Promise<unknown>;

const ACCOUNT = { id: 'account-1', apiKeyEncrypted: 'k', keyInvalidAt: null };

function owner(id = 'owner-1', subscriptionStatus: string | null = 'active') {
  return {
    id,
    academiaId: `academia-${id}`,
    subscriptionStatus,
    product: { type: 'ACADEMIA', tier: 'STANDARD' },
  };
}

function item(
  id: string,
  overrides: {
    dueDay?: number;
    amountCents?: number;
    customAmount?: boolean;
    owner?: ReturnType<typeof owner> | null;
    accessPlanId?: string;
  } = {},
): IssuableBilling {
  return {
    billing: {
      id: `rec-${id}`,
      clientId: `client-${id}`,
      accessPlanId: overrides.accessPlanId ?? 'plan-1',
      dueDay: overrides.dueDay ?? 27,
      amountCents: overrides.amountCents ?? 14990,
      customAmount: overrides.customAmount ?? false,
      status: 'ACTIVE',
      startedAt: new Date('2026-01-05T12:00:00.000Z'),
      endedAt: null,
    },
    client: { id: `client-${id}`, name: `Aluno ${id}` },
    owner: overrides.owner === undefined ? owner() : overrides.owner,
  } as unknown as IssuableBilling;
}

// Keeps the highest issued competence per row, like the database does, and
// refuses a second fee for the same student and competence like the unique
// index does.
function makeDeps(billings: IssuableBilling[], last: Record<string, string>) {
  const lastCompetences = new Map(
    Object.entries(last).map(([id, value]) => {
      const [year, month] = value.split('/').map(Number);
      return [id, { year, month }];
    }),
  );
  const issuedKeys = new Set<string>();
  const issued: Array<Record<string, unknown>> = [];
  return {
    issued,
    lastCompetences,
    recurring: {
      findIssuable: jest.fn().mockResolvedValue(billings),
      findLastCompetences: jest
        .fn()
        .mockImplementation(() => Promise.resolve(new Map(lastCompetences))),
    },
    invoices: {
      issueRecurringFee: jest.fn().mockImplementation((input) => {
        const key = `${input.client.id}/${input.competence.year}/${input.competence.month}`;
        if (issuedKeys.has(key)) {
          return Promise.reject(
            new CodedError('exists', 409, 'invoice_exists_for_month'),
          );
        }
        issuedKeys.add(key);
        issued.push(input);
        const previous = lastCompetences.get(input.recurringBillingId);
        const newer =
          !previous ||
          previous.year * 12 + previous.month <
            input.competence.year * 12 + input.competence.month;
        if (newer)
          lastCompetences.set(input.recurringBillingId, input.competence);
        return Promise.resolve({ id: `inv-${issued.length}` });
      }),
    },
    accounts: { findActiveByUser: jest.fn().mockResolvedValue(ACCOUNT) },
    catalog: { findByIds: jest.fn().mockResolvedValue([]) },
    clock: { now: jest.fn().mockReturnValue(new Date('2026-11-17T15:00:00Z')) },
  };
}

function makeIssuer(deps: ReturnType<typeof makeDeps>) {
  return new RecurringFeeIssuer(
    deps.recurring as never,
    deps.invoices as never,
    deps.accounts as never,
    deps.catalog as never,
    deps.clock as never,
  );
}

const logs = {
  log: jest.fn(),
  warn: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Logger.prototype, 'log').mockImplementation(logs.log);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(logs.warn);
  jest.spyOn(Logger.prototype, 'error').mockImplementation();
});

afterEach(() => jest.restoreAllMocks());

describe('RecurringFeeIssuer', () => {
  it('UT-061 issues the next competence for a row whose last fee was October, at the recurring amount, tied to the row', async () => {
    const deps = makeDeps([item('a')], { 'rec-a': '2026/10' });

    const summary = await makeIssuer(deps).run();

    expect(summary).toEqual({ issued: 1, skipped: 0, failed: 0 });
    expect(deps.issued[0]).toMatchObject({
      recurringBillingId: 'rec-a',
      competence: { year: 2026, month: 11 },
      dueDate: '2026-11-27',
      amountCents: 14990,
      account: ACCOUNT,
    });
  });

  it('UT-062 a due date 11 days away is not issued, 10 days away is', async () => {
    const deps = makeDeps([item('a')], { 'rec-a': '2026/10' });
    const issuer = makeIssuer(deps);

    deps.clock.now.mockReturnValue(new Date('2026-11-16T15:00:00Z'));
    expect(await issuer.run()).toEqual({ issued: 0, skipped: 1, failed: 0 });

    deps.clock.now.mockReturnValue(new Date('2026-11-17T15:00:00Z'));
    expect(await issuer.run()).toEqual({ issued: 1, skipped: 0, failed: 0 });
  });

  it('UT-063 running twice on the same day issues once and skips the second time', async () => {
    const deps = makeDeps([item('a')], { 'rec-a': '2026/10' });
    const issuer = makeIssuer(deps);

    const first = await issuer.run();
    const second = await issuer.run();

    expect(first).toEqual({ issued: 1, skipped: 0, failed: 0 });
    expect(second).toEqual({ issued: 0, skipped: 1, failed: 0 });
    expect(deps.issued).toHaveLength(1);
  });

  it('UT-064 two runs started together issue one fee; the loser counts a skip and throws nothing', async () => {
    const deps = makeDeps([item('a')], { 'rec-a': '2026/10' });
    const issuer = makeIssuer(deps);

    const [one, two] = await Promise.all([issuer.run(), issuer.run()]);

    expect(deps.issued).toHaveLength(1);
    expect(one.issued + two.issued).toBe(1);
    expect(one.skipped + two.skipped).toBe(1);
    expect(one.failed + two.failed).toBe(0);
  });

  it('UT-065 a rejected charge fails only that row, is reported to Sentry, and is retried by the next run', async () => {
    const deps = makeDeps([item('b1'), item('b2'), item('b3')], {
      'rec-b1': '2026/10',
      'rec-b2': '2026/10',
      'rec-b3': '2026/10',
    });
    const gatewayError = new CodedError('rejeitada', 422, 'gateway_rejected');
    const original =
      deps.invoices.issueRecurringFee.getMockImplementation()! as IssueFn;
    deps.invoices.issueRecurringFee.mockImplementation(
      (input: { client: { id: string } }) =>
        input.client.id === 'client-b2'
          ? Promise.reject(gatewayError)
          : original(input),
    );
    const issuer = makeIssuer(deps);

    const first = await issuer.run();

    expect(first).toEqual({ issued: 2, skipped: 0, failed: 1 });
    expect(Sentry.captureException).toHaveBeenCalledWith(
      gatewayError,
      expect.objectContaining({
        extra: expect.objectContaining({ clientId: 'client-b2' }),
      }),
    );

    deps.invoices.issueRecurringFee.mockImplementation(original);
    const second = await issuer.run();
    expect(second).toEqual({ issued: 1, skipped: 2, failed: 0 });
    expect(deps.issued.map((i) => (i.client as { id: string }).id)).toContain(
      'client-b2',
    );
  });

  it.each([
    ['a rejected key', { ...ACCOUNT, keyInvalidAt: new Date() }],
    ['a disconnected account', { ...ACCOUNT, apiKeyEncrypted: null }],
    ['no active account', null],
  ])(
    'UT-066 %s skips all of that owner’s rows with nothing issued',
    async (_label, account) => {
      const deps = makeDeps([item('a'), item('b')], {
        'rec-a': '2026/10',
        'rec-b': '2026/10',
      });
      deps.accounts.findActiveByUser.mockResolvedValue(account);

      const summary = await makeIssuer(deps).run();

      expect(summary).toEqual({ issued: 0, skipped: 2, failed: 0 });
      expect(deps.invoices.issueRecurringFee).not.toHaveBeenCalled();
    },
  );

  it('UT-067 after reconnecting, the missed months are issued with due date today and their own competences', async () => {
    const deps = makeDeps([item('a', { dueDay: 28 })], { 'rec-a': '2026/08' });

    const summary = await makeIssuer(deps).run();

    expect(summary.issued).toBe(2);
    expect(deps.issued.map((i) => [i.competence, i.dueDate])).toEqual([
      [{ year: 2026, month: 9 }, '2026-11-17'],
      [{ year: 2026, month: 10 }, '2026-11-17'],
    ]);
  });

  it('UT-068 five missed months issue the three most recent and log the capped ones', async () => {
    const deps = makeDeps([item('a', { dueDay: 28 })], { 'rec-a': '2026/05' });

    const summary = await makeIssuer(deps).run();

    expect(summary.issued).toBe(3);
    expect(
      deps.issued.map((i) => (i.competence as { month: number }).month),
    ).toEqual([8, 9, 10]);
    expect(logs.warn).toHaveBeenCalledWith(
      expect.stringContaining('recurring_catchup_capped'),
    );
  });

  it.each([
    ['2027-02-17', 0],
    ['2027-02-18', 1],
  ])(
    'UT-069 due day 28 for February 2027 on %s issues %i fee(s)',
    async (today, expected) => {
      const deps = makeDeps([item('a', { dueDay: 28 })], {
        'rec-a': '2027/01',
      });
      deps.clock.now.mockReturnValue(new Date(`${today}T15:00:00Z`));

      const summary = await makeIssuer(deps).run();

      expect(summary.issued).toBe(expected);
      if (expected === 1) expect(deps.issued[0].dueDate).toBe('2027-02-28');
    },
  );

  it('UT-070 only active rows are ever loaded for issuing', async () => {
    const deps = makeDeps([], {});

    const summary = await makeIssuer(deps).run();

    expect(summary).toEqual({ issued: 0, skipped: 0, failed: 0 });
    expect(deps.recurring.findIssuable).toHaveBeenCalledTimes(1);
    expect(deps.invoices.issueRecurringFee).not.toHaveBeenCalled();
  });

  it('UT-071 an unpaid previous fee does not hold back the next one', async () => {
    const deps = makeDeps([item('a')], { 'rec-a': '2026/10' });

    const summary = await makeIssuer(deps).run();

    expect(summary.issued).toBe(1);
  });

  it('UT-072 a canceled November fee counts as November: nothing is re-issued and the next month is derived from it', async () => {
    const deps = makeDeps([item('a', { dueDay: 20 })], { 'rec-a': '2026/11' });
    const issuer = makeIssuer(deps);

    expect(await issuer.run()).toEqual({ issued: 0, skipped: 1, failed: 0 });

    deps.clock.now.mockReturnValue(new Date('2026-12-10T15:00:00Z'));
    await issuer.run();
    expect(deps.issued.map((i) => i.competence)).toEqual([
      { year: 2026, month: 12 },
    ]);
  });

  it('UT-073 a student whose tax ID is gone is skipped and logged without stopping the others', async () => {
    const deps = makeDeps([item('a'), item('b')], {
      'rec-a': '2026/10',
      'rec-b': '2026/10',
    });
    const original =
      deps.invoices.issueRecurringFee.getMockImplementation()! as IssueFn;
    deps.invoices.issueRecurringFee.mockImplementation(
      (input: { client: { id: string } }) =>
        input.client.id === 'client-a'
          ? Promise.reject(new CodedError('sem CPF', 400, 'tax_id_required'))
          : original(input),
    );

    const summary = await makeIssuer(deps).run();

    expect(summary).toEqual({ issued: 1, skipped: 1, failed: 0 });
    expect(logs.log).toHaveBeenCalledWith(
      expect.stringContaining('reason=tax_id_missing'),
    );
  });

  it('UT-074 an owner whose subscription lapsed has every row skipped and nothing touched', async () => {
    const deps = makeDeps(
      [item('a', { owner: owner('owner-1', 'canceled') })],
      { 'rec-a': '2026/10' },
    );

    const summary = await makeIssuer(deps).run();

    expect(summary).toEqual({ issued: 0, skipped: 1, failed: 0 });
    expect(deps.accounts.findActiveByUser).not.toHaveBeenCalled();
    expect(deps.invoices.issueRecurringFee).not.toHaveBeenCalled();
    expect(logs.log).toHaveBeenCalledWith(
      expect.stringContaining('reason=subscription_inactive'),
    );
  });

  it('UT-075 a run cut short after two rows is completed by the next one without duplicates', async () => {
    const ids = ['1', '2', '3', '4', '5'];
    const deps = makeDeps(
      ids.map((id) => item(id)),
      Object.fromEntries(ids.map((id) => [`rec-${id}`, '2026/10'])),
    );
    const issuer = makeIssuer(deps);
    (sleep as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('process killed'));

    await expect(issuer.run()).rejects.toThrow('process killed');
    expect(deps.issued).toHaveLength(3);

    const second = await issuer.run();
    expect(second).toEqual({ issued: 2, skipped: 3, failed: 0 });
    expect(deps.issued).toHaveLength(5);
  });

  it('UT-076 5,000 rows across 50 owners are all considered, with a pause after each gateway call', async () => {
    const billings: IssuableBilling[] = [];
    const last: Record<string, string> = {};
    for (let i = 0; i < 5000; i += 1) {
      billings.push(item(String(i), { owner: owner(`o${i % 50}`) }));
      last[`rec-${i}`] = '2026/10';
    }
    const deps = makeDeps(billings, last);

    const summary = await makeIssuer(deps).run();

    expect(summary).toEqual({ issued: 5000, skipped: 0, failed: 0 });
    expect(deps.accounts.findActiveByUser).toHaveBeenCalledTimes(50);
    expect(sleep).toHaveBeenCalledTimes(5000);
    expect(sleep).toHaveBeenCalledWith(200);
  });

  it('UT-077 run() is scheduled at 03:45 in Brasília time', () => {
    const metadata = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      Object.getOwnPropertyDescriptor(RecurringFeeIssuer.prototype, 'run')!
        .value as object,
    ) as { cronTime: string; timeZone: string };

    expect(metadata.cronTime).toBe('45 3 * * *');
    expect(metadata.timeZone).toBe('America/Sao_Paulo');
  });

  it('UT-058 the next fee of a non-custom row follows the edited catalog price; a custom row and the issued fee do not change', async () => {
    const deps = makeDeps(
      [
        item('plain', { amountCents: 14990 }),
        item('custom', { amountCents: 12000, customAmount: true }),
      ],
      { 'rec-plain': '2026/10', 'rec-custom': '2026/10' },
    );
    deps.catalog.findByIds.mockResolvedValue([
      { id: 'plan-1', referencePrice: 159.9 },
    ]);

    await makeIssuer(deps).run();

    const amounts = Object.fromEntries(
      deps.issued.map((i) => [(i.client as { id: string }).id, i.amountCents]),
    );
    expect(amounts).toEqual({ 'client-plain': 15990, 'client-custom': 12000 });
  });

  it('a row with no invoice yet gets its first competence from its start date', async () => {
    const deps = makeDeps(
      [
        {
          ...item('a', { dueDay: 20 }),
          billing: {
            ...item('a', { dueDay: 20 }).billing,
            startedAt: new Date('2026-11-17T15:00:00Z'),
          },
        },
      ],
      {},
    );

    const summary = await makeIssuer(deps).run();

    expect(summary.issued).toBe(1);
    expect(deps.issued[0]).toMatchObject({
      competence: { year: 2026, month: 11 },
      dueDate: '2026-11-20',
    });
  });
});
