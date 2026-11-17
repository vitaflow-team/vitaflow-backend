import type { BillingOwner } from '@/billing/owner/types/billingOwner';
import { CodedError } from '@/common/errors/codedError';
import { Logger } from '@nestjs/common';
import { GymBillingActivationService } from './gymBillingActivation.service';

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

type IssueFn = (input: unknown) => Promise<unknown>;

const NOW = new Date('2026-11-17T15:00:00.000Z');
const OWNER: BillingOwner = {
  ownerId: 'owner-1',
  kind: 'GYM',
  academiaId: 'academia-1',
};
const ACCOUNT = { id: 'account-1' };

// A small stateful world: students with an active plan, the recurring rows
// created so far and the fees issued.
function makeDeps(clientIds: string[]) {
  const rows = new Map<string, Record<string, unknown>>();
  const noTaxId = new Set<string>();
  const archived = new Set<string>();
  const issued: Array<Record<string, unknown>> = [];
  const deps = {
    rows,
    noTaxId,
    archived,
    issued,
    recurring: {
      findEligible: jest.fn().mockResolvedValue([]),
      findActiveByClient: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(rows.get(id) ?? null),
        ),
      createForActivePlan: jest.fn().mockImplementation((data) => {
        if (rows.has(data.clientId)) return Promise.resolve(null);
        const row = { id: `rec-${data.clientId}`, ...data };
        rows.set(data.clientId, row);
        return Promise.resolve(row);
      }),
      deleteById: jest.fn().mockImplementation((id: string) => {
        for (const [clientId, row] of rows) {
          if (row.id === id) rows.delete(clientId);
        }
        return Promise.resolve();
      }),
    },
    plans: {
      findActiveByClient: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(
            archived.has(id)
              ? null
              : { clientId: id, accessPlanId: 'plan-1', referencePrice: 149.9 },
          ),
        ),
    },
    taxIds: {
      find: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(noTaxId.has(id) ? null : { clientId: id }),
        ),
    },
    clients: {
      getClientById: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(
            clientIds.includes(id)
              ? { id, academiaId: 'academia-1', professionalId: null }
              : null,
          ),
        ),
    },
    invoices: {
      requireIssuingAccount: jest.fn().mockResolvedValue(ACCOUNT),
      issueRecurringFee: jest.fn().mockImplementation((input) => {
        issued.push(input);
        return Promise.resolve({ id: `inv-${issued.length}` });
      }),
    },
    clock: { now: jest.fn().mockReturnValue(NOW) },
  };
  return deps;
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new GymBillingActivationService(
    deps.recurring as never,
    deps.plans as never,
    deps.taxIds as never,
    deps.clients as never,
    deps.invoices as never,
    deps.clock as never,
  );
}

function items(ids: string[], extra: Record<string, unknown> = { dueDay: 10 }) {
  return ids.map((clientId) => ({ clientId, ...extra }));
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  jest.spyOn(Logger.prototype, 'error').mockImplementation();
});

afterEach(() => jest.restoreAllMocks());

describe('GymBillingActivationService.activateMany', () => {
  it('UT-078 activates three eligible students with due day 10: three rows and three first fees', async () => {
    const deps = makeDeps(['a', 'b', 'c']);

    const result = await makeService(deps).activateMany({
      owner: OWNER,
      items: items(['a', 'b', 'c']),
    });

    expect(result).toEqual({ activated: ['a', 'b', 'c'], skipped: [] });
    expect(deps.rows.size).toBe(3);
    expect(deps.issued).toHaveLength(3);
    expect(deps.issued[0]).toMatchObject({
      amountCents: 14990,
      dueDate: '2026-12-10',
      competence: { year: 2026, month: 12 },
      account: ACCOUNT,
    });
  });

  it('UT-078 an amount other than the plan price is custom', async () => {
    const deps = makeDeps(['a']);

    await makeService(deps).activateMany({
      owner: OWNER,
      items: items(['a'], { dueDay: 10, amountCents: 12000 }),
    });

    expect(deps.recurring.createForActivePlan).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 12000, customAmount: true }),
    );
  });

  it('UT-079 a student without a tax ID is skipped with its reason and the others are activated', async () => {
    const deps = makeDeps(['a', 'b', 'c']);
    deps.noTaxId.add('b');

    const result = await makeService(deps).activateMany({
      owner: OWNER,
      items: items(['a', 'b', 'c']),
    });

    expect(result.activated).toEqual(['a', 'c']);
    expect(result.skipped).toEqual([
      { clientId: 'b', reason: 'tax_id_missing' },
    ]);
    expect(deps.rows.has('b')).toBe(false);
  });

  it('UT-080 repeating the same call skips every item as already_billing and issues nothing more', async () => {
    const deps = makeDeps(['a', 'b']);
    const service = makeService(deps);
    await service.activateMany({ owner: OWNER, items: items(['a', 'b']) });

    const second = await service.activateMany({
      owner: OWNER,
      items: items(['a', 'b']),
    });

    expect(second.activated).toEqual([]);
    expect(second.skipped.map((s) => s.reason)).toEqual([
      'already_billing',
      'already_billing',
    ]);
    expect(deps.issued).toHaveLength(2);
  });

  it('UT-081 a student whose plan was archived before the call is skipped with no_active_plan', async () => {
    const deps = makeDeps(['a', 'b']);
    deps.archived.add('a');

    const result = await makeService(deps).activateMany({
      owner: OWNER,
      items: items(['a', 'b']),
    });

    expect(result.skipped).toEqual([
      { clientId: 'a', reason: 'no_active_plan' },
    ]);
    expect(result.activated).toEqual(['b']);
  });

  it('UT-081 a student that is not the gym’s own is also not activatable', async () => {
    const deps = makeDeps(['a']);

    const result = await makeService(deps).activateMany({
      owner: OWNER,
      items: items(['stranger']),
    });

    expect(result.skipped).toEqual([
      { clientId: 'stranger', reason: 'no_active_plan' },
    ]);
  });

  it('UT-082 without a connected account the whole call is refused and nothing changes', async () => {
    const deps = makeDeps(['a']);
    deps.invoices.requireIssuingAccount.mockRejectedValue(
      new CodedError('conecte', 409, 'billing_not_connected'),
    );

    await expect(
      makeService(deps).activateMany({ owner: OWNER, items: items(['a']) }),
    ).rejects.toMatchObject({ status: 409, code: 'billing_not_connected' });
    expect(deps.recurring.createForActivePlan).not.toHaveBeenCalled();
  });

  it('UT-083 an empty selection and a selection of 201 are refused; exactly 200 is accepted', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `c${i}`);
    const deps = makeDeps(ids);
    const service = makeService(deps);

    await expect(
      service.activateMany({ owner: OWNER, items: [] }),
    ).rejects.toMatchObject({ status: 400, code: 'empty_selection' });
    await expect(
      service.activateMany({ owner: OWNER, items: items(ids) }),
    ).rejects.toMatchObject({ status: 400, code: 'selection_too_large' });
    expect(deps.recurring.createForActivePlan).not.toHaveBeenCalled();

    const result = await service.activateMany({
      owner: OWNER,
      items: items(ids.slice(0, 200)),
    });
    expect(result.activated).toHaveLength(200);
  });

  it('UT-084 a gateway failure on the third of five skips only that student, which a retry then activates', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const deps = makeDeps(ids);
    const original =
      deps.invoices.issueRecurringFee.getMockImplementation()! as IssueFn;
    deps.invoices.issueRecurringFee.mockImplementation(
      (input: { client: { id: string } }) =>
        input.client.id === 'c'
          ? Promise.reject(new CodedError('fora', 503, 'gateway_unavailable'))
          : original(input),
    );
    const service = makeService(deps);

    const first = await service.activateMany({
      owner: OWNER,
      items: items(ids),
    });

    expect(first.activated).toEqual(['a', 'b', 'd', 'e']);
    expect(first.skipped).toEqual([
      { clientId: 'c', reason: 'gateway_failed' },
    ]);
    expect(deps.rows.has('c')).toBe(false);

    deps.invoices.issueRecurringFee.mockImplementation(original);
    const retry = await service.activateMany({
      owner: OWNER,
      items: items(['c']),
    });
    expect(retry.activated).toEqual(['c']);
  });

  it('UT-085 lists the eligible students with whether a tax ID is on file, and an empty list when none qualify', async () => {
    const deps = makeDeps([]);
    const service = makeService(deps);
    expect(await service.eligibleForActivation('academia-1')).toEqual([]);

    deps.recurring.findEligible.mockResolvedValue([
      {
        clientId: 'a',
        name: 'Ana',
        planName: 'Mensal',
        referencePrice: 149.9,
        hasTaxId: true,
      },
      {
        clientId: 'b',
        name: 'Bia',
        planName: 'Mensal',
        referencePrice: '99.00',
        hasTaxId: false,
      },
    ]);

    expect(await service.eligibleForActivation('academia-1')).toEqual([
      {
        clientId: 'a',
        name: 'Ana',
        planName: 'Mensal',
        amountCents: 14990,
        hasTaxId: true,
      },
      {
        clientId: 'b',
        name: 'Bia',
        planName: 'Mensal',
        amountCents: 9900,
        hasTaxId: false,
      },
    ]);
  });

  it('UT-086 200 items are processed one at a time and every one is accounted for', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `c${i}`);
    const deps = makeDeps(ids);
    deps.noTaxId.add('c7');
    let running = 0;
    let peak = 0;
    const original =
      deps.invoices.issueRecurringFee.getMockImplementation()! as IssueFn;
    deps.invoices.issueRecurringFee.mockImplementation(async (input) => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
      return original(input);
    });

    const result = await makeService(deps).activateMany({
      owner: OWNER,
      items: items(ids),
    });

    expect(result.activated.length + result.skipped.length).toBe(200);
    expect(peak).toBe(1);
  });

  it('refuses an invalid due day or amount before activating anyone', async () => {
    const deps = makeDeps(['a', 'b']);
    const service = makeService(deps);

    await expect(
      service.activateMany({
        owner: OWNER,
        items: [
          { clientId: 'a', dueDay: 10 },
          { clientId: 'b', dueDay: 31 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'invalid_due_day' });
    await expect(
      service.activateMany({
        owner: OWNER,
        items: [{ clientId: 'a', amountCents: 100 }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_amount' });
    expect(deps.recurring.createForActivePlan).not.toHaveBeenCalled();
  });

  it('defaults the due day to today, capped at 28, when an item gives none', async () => {
    const deps = makeDeps(['a']);

    await makeService(deps).activateMany({
      owner: OWNER,
      items: [{ clientId: 'a' }],
    });

    expect(deps.recurring.createForActivePlan).toHaveBeenCalledWith(
      expect.objectContaining({ dueDay: 17 }),
    );
  });
});
