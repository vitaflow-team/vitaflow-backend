import type { BillingOwner } from '@/billing/owner/types/billingOwner';
import { CodedError } from '@/common/errors/codedError';
import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { AuthGuard } from '@/auth/auth.guard';
import { StudentAccessPlanController } from '@/academia/checkin/studentAccessPlan.controller';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import * as Sentry from '@sentry/node';
import { GymRecurringBillingService } from './gymRecurringBilling.service';
import { StudentBillingController } from './studentBilling.controller';

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

const NOW = new Date('2026-11-17T15:00:00.000Z');
const OWNER: BillingOwner = {
  ownerId: 'owner-1',
  kind: 'GYM',
  academiaId: 'academia-1',
};

function catalogPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-cat-1',
    academiaId: 'academia-1',
    name: 'Mensal',
    validityType: 'DAYS',
    validityValue: 30,
    referencePrice: 149.9,
    active: true,
    ...overrides,
  };
}

function makeDeps() {
  return {
    recurring: {
      findActiveByClient: jest.fn().mockResolvedValue(null),
      createLink: jest.fn().mockImplementation((data) =>
        Promise.resolve({
          plan: { id: 'plan-new', clientId: 'client-1' },
          billing: {
            id: 'rec-1',
            status: 'ACTIVE',
            startedAt: NOW,
            endedAt: null,
            ...data.billing,
          },
          previousPlanId: 'plan-old',
        }),
      ),
      rollbackLink: jest.fn().mockResolvedValue(undefined),
      endLink: jest.fn().mockResolvedValue({ billingId: 'rec-1' }),
      updateTerms: jest.fn().mockImplementation((_clientId, change) =>
        Promise.resolve({
          ...activeBilling(),
          ...change,
        }),
      ),
      followPlan: jest.fn().mockResolvedValue(undefined),
    },
    plans: {
      create: jest.fn().mockResolvedValue({ id: 'plan-free' }),
      activate: jest.fn().mockResolvedValue(true),
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'plan-free', status: 'ACTIVE' }),
    },
    catalog: { findById: jest.fn().mockResolvedValue(catalogPlan()) },
    clients: {
      getClientById: jest.fn().mockResolvedValue({
        id: 'client-1',
        academiaId: 'academia-1',
        professionalId: null,
      }),
    },
    invoices: {
      requireIssuingAccount: jest.fn().mockResolvedValue({ id: 'account-1' }),
      resolveTaxId: jest.fn().mockResolvedValue('52998224725'),
      issueRecurringFee: jest
        .fn()
        .mockResolvedValue({ id: 'inv-1', amountCents: 14990 }),
      cancelUpcomingFees: jest.fn().mockResolvedValue(0),
      toResponse: jest.fn().mockImplementation((invoice: unknown) => invoice),
    },
    clock: { now: jest.fn().mockReturnValue(NOW) },
  };
}

function activeBilling(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    clientId: 'client-1',
    accessPlanId: 'plan-cat-1',
    dueDay: 10,
    amountCents: 14990,
    customAmount: false,
    status: 'ACTIVE',
    startedAt: NOW,
    endedAt: null,
    ...overrides,
  };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new GymRecurringBillingService(
    deps.recurring as never,
    deps.plans as never,
    deps.catalog as never,
    deps.clients as never,
    deps.invoices as never,
    deps.clock as never,
  );
}

function link(
  service: GymRecurringBillingService,
  billing: Record<string, unknown> = { dueDay: 10 },
) {
  return service.linkWithBilling({
    owner: OWNER,
    clientId: 'client-1',
    accessPlanId: 'plan-cat-1',
    billing,
  });
}

describe('GymRecurringBillingService.linkWithBilling', () => {
  it('UT-043 the amount defaults to the plan price and is not custom; an override is custom', async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await link(service);
    expect(deps.recurring.createLink).toHaveBeenLastCalledWith(
      expect.objectContaining({
        billing: expect.objectContaining({
          amountCents: 14990,
          customAmount: false,
        }),
      }),
    );

    await link(service, { dueDay: 10, amountCents: 12000 });
    expect(deps.recurring.createLink).toHaveBeenLastCalledWith(
      expect.objectContaining({
        billing: expect.objectContaining({
          amountCents: 12000,
          customAmount: true,
        }),
      }),
    );
  });

  it('UT-043 an override equal to the plan price is not custom, and the due day defaults to today', async () => {
    const deps = makeDeps();

    await link(makeService(deps), { amountCents: 14990 });

    expect(deps.recurring.createLink).toHaveBeenCalledWith(
      expect.objectContaining({
        billing: expect.objectContaining({
          dueDay: 17,
          amountCents: 14990,
          customAmount: false,
        }),
      }),
    );
  });

  it('UT-041 an invalid due day is refused before anything is written', async () => {
    const deps = makeDeps();

    await expect(link(makeService(deps), { dueDay: 29 })).rejects.toMatchObject(
      { code: 'invalid_due_day' },
    );
    expect(deps.recurring.createLink).not.toHaveBeenCalled();
  });

  it('UT-042 an out-of-range amount is refused before anything is written', async () => {
    const deps = makeDeps();

    await expect(
      link(makeService(deps), { dueDay: 10, amountCents: 499 }),
    ).rejects.toMatchObject({ code: 'invalid_amount' });
    expect(deps.recurring.createLink).not.toHaveBeenCalled();
  });

  it('UT-044 a free plan with no amount is assigned without recurring row, invoice or billing in the result', async () => {
    const deps = makeDeps();
    deps.catalog.findById.mockResolvedValue(catalogPlan({ referencePrice: 0 }));

    const result = await link(makeService(deps));

    expect(result.billing).toBeNull();
    expect(result.firstInvoice).toBeNull();
    expect(deps.plans.create).toHaveBeenCalled();
    expect(deps.plans.activate).toHaveBeenCalledWith('client-1', 'plan-free');
    expect(deps.recurring.createLink).not.toHaveBeenCalled();
    expect(deps.invoices.issueRecurringFee).not.toHaveBeenCalled();
  });

  it('UT-045 a student without a tax ID and none in the request is refused with tax_id_required and nothing changes', async () => {
    const deps = makeDeps();
    deps.invoices.resolveTaxId.mockRejectedValue(
      new CodedError('Informe o CPF ou CNPJ do aluno.', 400, 'tax_id_required'),
    );

    await expect(link(makeService(deps))).rejects.toMatchObject({
      code: 'tax_id_required',
    });
    expect(deps.recurring.createLink).not.toHaveBeenCalled();
  });

  it('UT-045 a tax ID sent in the request is handed over for storage', async () => {
    const deps = makeDeps();

    await link(makeService(deps), { dueDay: 10, cpfCnpj: '529.982.247-25' });

    expect(deps.invoices.resolveTaxId).toHaveBeenCalledWith(
      'client-1',
      '529.982.247-25',
    );
  });

  it.each([
    ['billing_not_connected', 'not connected'],
    ['billing_reconnect_needed', 'key rejected'],
    ['subscription_required', 'subscription lapsed'],
  ])('UT-046 %s (%s) leaves the access plan untouched', async (code) => {
    const deps = makeDeps();
    deps.invoices.requireIssuingAccount.mockRejectedValue(
      new CodedError('refused', 409, code),
    );

    await expect(link(makeService(deps))).rejects.toMatchObject({ code });
    expect(deps.recurring.createLink).not.toHaveBeenCalled();
    expect(deps.invoices.resolveTaxId).not.toHaveBeenCalled();
  });

  it.each([
    ['another academia', { academiaId: 'academia-2', professionalId: null }],
    ['an independent professional', { academiaId: null, professionalId: 'e1' }],
  ])('UT-047 a student of %s is not found', async (_label, client) => {
    const deps = makeDeps();
    deps.clients.getClientById.mockResolvedValue({ id: 'client-1', ...client });

    await expect(link(makeService(deps))).rejects.toMatchObject({
      code: 'student_not_found',
    });
    expect(deps.recurring.createLink).not.toHaveBeenCalled();
  });

  it('UT-048 a student that already has an active recurring billing is refused with recurring_billing_exists', async () => {
    const deps = makeDeps();
    deps.recurring.findActiveByClient.mockResolvedValue(activeBilling());

    await expect(link(makeService(deps))).rejects.toMatchObject({
      status: 409,
      code: 'recurring_billing_exists',
    });
    expect(deps.recurring.createLink).not.toHaveBeenCalled();
  });

  it.each([
    ['an inactive plan', catalogPlan({ active: false })],
    ['a plan of another academia', null],
  ])('UT-049 %s is access_plan_not_found', async (_label, plan) => {
    const deps = makeDeps();
    deps.catalog.findById.mockResolvedValue(plan);

    await expect(link(makeService(deps))).rejects.toMatchObject({
      code: 'access_plan_not_found',
    });
    expect(deps.recurring.createLink).not.toHaveBeenCalled();
  });

  it('UT-050 due day 10 on 2026-11-17 issues the first fee at the plan price for December, tied to the new row', async () => {
    const deps = makeDeps();

    const result = await link(makeService(deps));

    expect(deps.invoices.issueRecurringFee).toHaveBeenCalledWith({
      account: { id: 'account-1' },
      client: expect.objectContaining({ id: 'client-1' }),
      recurringBillingId: 'rec-1',
      competence: { year: 2026, month: 12 },
      amountCents: 14990,
      dueDate: '2026-12-10',
    });
    expect(result.firstInvoice).toMatchObject({ id: 'inv-1' });
    expect(result.billing).toMatchObject({ dueDay: 10, amountCents: 14990 });
  });

  it('UT-051 a failing first fee undoes the link and propagates the gateway error', async () => {
    const deps = makeDeps();
    const failure = new CodedError('indisponível', 503, 'gateway_unavailable');
    deps.invoices.issueRecurringFee.mockRejectedValue(failure);

    await expect(link(makeService(deps))).rejects.toBe(failure);

    expect(deps.recurring.rollbackLink).toHaveBeenCalledWith(
      expect.objectContaining({
        previousPlanId: 'plan-old',
        billing: expect.objectContaining({ id: 'rec-1' }),
      }),
    );
  });

  it('UT-051 a compensation that fails is reported, and the original error is the one thrown', async () => {
    const deps = makeDeps();
    const failure = new CodedError('indisponível', 503, 'gateway_unavailable');
    deps.invoices.issueRecurringFee.mockRejectedValue(failure);
    deps.recurring.rollbackLink.mockRejectedValue(new Error('db down'));

    await expect(link(makeService(deps))).rejects.toBe(failure);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        level: 'fatal',
        extra: { clientId: 'client-1' },
      }),
    );
  });

  it('UT-052 two simultaneous links: one is created, the other is refused, and a single first fee is issued', async () => {
    const deps = makeDeps();
    deps.recurring.createLink
      .mockImplementationOnce((data) =>
        Promise.resolve({
          plan: { id: 'plan-new', clientId: 'client-1' },
          billing: { id: 'rec-1', startedAt: NOW, ...data.billing },
          previousPlanId: null,
        }),
      )
      .mockResolvedValueOnce(null);
    const service = makeService(deps);

    const results = await Promise.allSettled([link(service), link(service)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      code: 'recurring_billing_exists',
    });
    expect(deps.invoices.issueRecurringFee).toHaveBeenCalledTimes(1);
  });
});

describe('GymRecurringBillingService.unlink', () => {
  const input = { owner: OWNER, clientId: 'client-1' };

  it('UT-053 archives the plan, ends the row and cancels the open fees due today or later', async () => {
    const deps = makeDeps();

    await makeService(deps).unlink(input);

    expect(deps.recurring.endLink).toHaveBeenCalledWith('client-1', NOW);
    expect(deps.invoices.cancelUpcomingFees).toHaveBeenCalledWith({
      ownerId: 'owner-1',
      clientId: 'client-1',
      todayKey: '2026-11-17',
    });
  });

  it('UT-054 unlinking twice: the second is student_has_no_plan and cancels nothing more', async () => {
    const deps = makeDeps();
    deps.recurring.endLink
      .mockResolvedValueOnce({ billingId: 'rec-1' })
      .mockResolvedValueOnce(null);
    const service = makeService(deps);

    await service.unlink(input);
    await expect(service.unlink(input)).rejects.toMatchObject({
      status: 404,
      code: 'student_has_no_plan',
    });

    expect(deps.invoices.cancelUpcomingFees).toHaveBeenCalledTimes(1);
  });

  it('refuses a student of another academia before touching anything', async () => {
    const deps = makeDeps();
    deps.clients.getClientById.mockResolvedValue({
      id: 'client-1',
      academiaId: 'academia-2',
      professionalId: null,
    });

    await expect(makeService(deps).unlink(input)).rejects.toMatchObject({
      code: 'student_not_found',
    });
    expect(deps.recurring.endLink).not.toHaveBeenCalled();
  });

  it('completes even when some fees could not be canceled at the gateway', async () => {
    const deps = makeDeps();
    deps.invoices.cancelUpcomingFees.mockResolvedValue(2);

    await expect(makeService(deps).unlink(input)).resolves.toBeUndefined();
  });
});

describe('GymRecurringBillingService.changeTerms', () => {
  it('UT-055 changes the due day only; a different amount is custom, one equal to the plan price is not', async () => {
    const deps = makeDeps();
    deps.recurring.findActiveByClient.mockResolvedValue(activeBilling());
    const service = makeService(deps);

    await service.changeTerms({
      owner: OWNER,
      clientId: 'client-1',
      dueDay: 20,
    });
    expect(deps.recurring.updateTerms).toHaveBeenLastCalledWith('client-1', {
      dueDay: 20,
    });

    await service.changeTerms({
      owner: OWNER,
      clientId: 'client-1',
      amountCents: 12000,
    });
    expect(deps.recurring.updateTerms).toHaveBeenLastCalledWith('client-1', {
      amountCents: 12000,
      customAmount: true,
    });

    await service.changeTerms({
      owner: OWNER,
      clientId: 'client-1',
      amountCents: 14990,
    });
    expect(deps.recurring.updateTerms).toHaveBeenLastCalledWith('client-1', {
      amountCents: 14990,
      customAmount: false,
    });
  });

  it('UT-056 saves the terms without any gateway call while the account key is rejected', async () => {
    const deps = makeDeps();
    deps.recurring.findActiveByClient.mockResolvedValue(activeBilling());
    deps.invoices.requireIssuingAccount.mockRejectedValue(
      new CodedError('reconnect', 409, 'billing_reconnect_needed'),
    );

    const view = await makeService(deps).changeTerms({
      owner: OWNER,
      clientId: 'client-1',
      dueDay: 15,
    });

    expect(view.dueDay).toBe(15);
    expect(deps.invoices.requireIssuingAccount).not.toHaveBeenCalled();
    expect(deps.invoices.issueRecurringFee).not.toHaveBeenCalled();
  });

  it('UT-059 a student with no active recurring billing is recurring_billing_not_found', async () => {
    const deps = makeDeps();

    await expect(
      makeService(deps).changeTerms({
        owner: OWNER,
        clientId: 'client-1',
        dueDay: 15,
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: 'recurring_billing_not_found',
    });
    expect(deps.recurring.updateTerms).not.toHaveBeenCalled();
  });

  it('UT-041 / UT-042 invalid terms are refused with their own codes', async () => {
    const deps = makeDeps();
    deps.recurring.findActiveByClient.mockResolvedValue(activeBilling());
    const service = makeService(deps);

    await expect(
      service.changeTerms({ owner: OWNER, clientId: 'client-1', dueDay: 0 }),
    ).rejects.toMatchObject({ code: 'invalid_due_day' });
    await expect(
      service.changeTerms({
        owner: OWNER,
        clientId: 'client-1',
        amountCents: 100,
      }),
    ).rejects.toMatchObject({ code: 'invalid_amount' });
  });

  it('with nothing to change it returns the current terms untouched', async () => {
    const deps = makeDeps();
    deps.recurring.findActiveByClient.mockResolvedValue(activeBilling());

    const view = await makeService(deps).changeTerms({
      owner: OWNER,
      clientId: 'client-1',
    });

    expect(view.dueDay).toBe(10);
    expect(deps.recurring.updateTerms).not.toHaveBeenCalled();
  });
});

describe('GymRecurringBillingService.followPlanChange', () => {
  const reassigned = {
    clientId: 'client-1',
    accessPlanId: 'plan-cat-2',
    referencePrice: 249.9,
  } as never;

  it('UT-057 re-assigning a 249.90 plan moves a non-custom row to the new plan and price', async () => {
    const deps = makeDeps();
    deps.recurring.findActiveByClient.mockResolvedValue(activeBilling());

    await makeService(deps).followPlanChange(reassigned);

    expect(deps.recurring.followPlan).toHaveBeenCalledWith('client-1', {
      accessPlanId: 'plan-cat-2',
      amountCents: 24990,
    });
  });

  it('UT-057 a custom row follows the plan but keeps its amount', async () => {
    const deps = makeDeps();
    deps.recurring.findActiveByClient.mockResolvedValue(
      activeBilling({ customAmount: true, amountCents: 12000 }),
    );

    await makeService(deps).followPlanChange(reassigned);

    expect(deps.recurring.followPlan).toHaveBeenCalledWith('client-1', {
      accessPlanId: 'plan-cat-2',
      amountCents: 12000,
    });
  });

  it('does nothing for a student without an active recurring row', async () => {
    const deps = makeDeps();

    await makeService(deps).followPlanChange(reassigned);

    expect(deps.recurring.followPlan).not.toHaveBeenCalled();
  });
});

describe('Access-plan billing routes are owner-only (UT-060)', () => {
  function classGuards(target: unknown): unknown[] {
    return (Reflect.getMetadata(GUARDS_METADATA, target as object) ??
      []) as unknown[];
  }

  it.each([
    [
      'StudentAccessPlanController (POST, DELETE access-plan)',
      StudentAccessPlanController,
    ],
    [
      'StudentBillingController (PATCH billing, eligible, activate)',
      StudentBillingController,
    ],
  ])(
    'UT-060 %s requires AuthGuard and AcademiaOwnerGuard on every route',
    (_name, controller) => {
      expect(classGuards(controller)).toEqual([AuthGuard, AcademiaOwnerGuard]);
    },
  );

  it('UT-060 the owner guard refuses a caller without an academia, which is every educator and receptionist principal', () => {
    const guard = new AcademiaOwnerGuard();
    const context = (user: unknown) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      }) as never;

    expect(() => guard.canActivate(context({ id: 'educator-1' }))).toThrow();
    expect(() =>
      guard.canActivate(context({ id: 'staff-1', academiaId: null })),
    ).toThrow();
    expect(guard.canActivate(context({ id: 'o', academiaId: 'a1' }))).toBe(
      true,
    );
  });
});
