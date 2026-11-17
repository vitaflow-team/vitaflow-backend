import { CodedError } from '@/common/errors/codedError';
import { UserRepository } from '@/repositories/users/user.repository';
import { ExecutionContext } from '@nestjs/common';
import { ProductTier, ProductType } from '@prisma/client';
import { BillingOwnerGuard } from './billingOwner.guard';
import { BillingOwnerService } from './billingOwner.service';
import { canViewClientBilling } from './billingOwnerRules';
import { BillingPlanGuard } from './billingPlan.guard';
import type { BillingSubject } from './types/billingSubject';

function subject(overrides: Partial<BillingSubject> = {}): BillingSubject {
  return {
    id: 'u1',
    academiaId: null,
    subscriptionStatus: 'active',
    product: { type: ProductType.PHYSICAL_EDUCATOR, tier: ProductTier.PREMIUM },
    ...overrides,
  };
}

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return (error as CodedError).code;
  }
  return undefined;
}

describe('BillingOwnerService', () => {
  const service = new BillingOwnerService();

  it('UT-019 resolves an educator and a nutritionist to a professional owner', () => {
    expect(service.resolve(subject())).toEqual({
      ownerId: 'u1',
      kind: 'PROFESSIONAL',
      academiaId: null,
    });
    expect(
      service.resolve(
        subject({
          product: {
            type: ProductType.NUTRITIONIST,
            tier: ProductTier.STANDARD,
          },
        }),
      ),
    ).toEqual({ ownerId: 'u1', kind: 'PROFESSIONAL', academiaId: null });
  });

  it('UT-020 resolves a gym owner to a gym owner carrying its academia', () => {
    const gym = subject({
      id: 'u2',
      academiaId: 'a1',
      product: { type: ProductType.ACADEMIA, tier: ProductTier.STANDARD },
    });
    expect(service.resolve(gym)).toEqual({
      ownerId: 'u2',
      kind: 'GYM',
      academiaId: 'a1',
    });
  });

  it('UT-021 refuses a student, a gym owner row without its academia and a receptionist principal', () => {
    const student = subject({
      product: { type: ProductType.USER, tier: ProductTier.FREE },
    });
    const orphanGym = subject({
      academiaId: null,
      product: { type: ProductType.ACADEMIA, tier: ProductTier.STANDARD },
    });
    const receptionist = subject({
      id: 'r1',
      academiaId: 'a1',
      subscriptionStatus: null,
      product: null,
    });

    for (const principal of [student, orphanGym, receptionist]) {
      expect(codeOf(() => service.resolve(principal))).toBe(
        'not_billing_owner',
      );
    }
  });

  it('UT-022 canBill: Premium plus a paid status for professionals, a paid status for gym owners', () => {
    expect(service.canBill(subject())).toBe(true);
    expect(
      service.canBill(
        subject({
          product: {
            type: ProductType.PHYSICAL_EDUCATOR,
            tier: ProductTier.STANDARD,
          },
        }),
      ),
    ).toBe(false);
    expect(service.canBill(subject({ subscriptionStatus: 'canceled' }))).toBe(
      false,
    );

    const gym = (status: string | null) =>
      subject({
        academiaId: 'a1',
        subscriptionStatus: status,
        product: { type: ProductType.ACADEMIA, tier: ProductTier.STANDARD },
      });
    for (const paid of ['active', 'trialing', 'past_due']) {
      expect(service.canBill(gym(paid))).toBe(true);
    }
    expect(service.canBill(gym('canceled'))).toBe(false);
    expect(service.canBill(gym(null))).toBe(false);
    expect(service.canBill(null)).toBe(false);
  });

  it('UT-023 ownsClient: a professional owns only independent clients, a gym owner only its own academia', () => {
    const professional = service.resolve(subject({ id: 'self' }));
    expect(
      service.ownsClient(professional, {
        professionalId: 'self',
        academiaId: null,
      }),
    ).toBe(true);
    expect(
      service.ownsClient(professional, {
        professionalId: 'self',
        academiaId: 'a1',
      }),
    ).toBe(false);
    expect(
      service.ownsClient(professional, {
        professionalId: 'other',
        academiaId: null,
      }),
    ).toBe(false);

    const gym = service.resolve(
      subject({
        academiaId: 'a1',
        product: { type: ProductType.ACADEMIA, tier: ProductTier.STANDARD },
      }),
    );
    expect(
      service.ownsClient(gym, { professionalId: null, academiaId: 'a1' }),
    ).toBe(true);
    expect(
      service.ownsClient(gym, { professionalId: 'e1', academiaId: 'a1' }),
    ).toBe(true);
    expect(
      service.ownsClient(gym, { professionalId: null, academiaId: 'a2' }),
    ).toBe(false);
    expect(
      service.ownsClient(gym, { professionalId: 'e1', academiaId: null }),
    ).toBe(false);
  });

  it('canViewClientBilling keeps an educator on a student who has since joined a gym, and never opens a foreign one', () => {
    const professional = service.resolve(subject({ id: 'self' }));
    expect(
      canViewClientBilling(professional, {
        professionalId: 'self',
        academiaId: 'a1',
      }),
    ).toBe(true);
    expect(
      canViewClientBilling(professional, {
        professionalId: 'other',
        academiaId: null,
      }),
    ).toBe(false);
  });
});

function contextOf(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('BillingOwnerGuard and BillingPlanGuard', () => {
  const owners = new BillingOwnerService();

  function users(user: unknown) {
    return {
      findByIdWithProduct: jest.fn().mockResolvedValue(user),
    } as unknown as UserRepository;
  }

  it('UT-019 the guard leaves the resolved owner on the request', async () => {
    const request: Record<string, unknown> = { user: { id: 'u1' } };
    const guard = new BillingOwnerGuard(users(subject()), owners);

    await expect(guard.canActivate(contextOf(request))).resolves.toBe(true);
    expect(request.billingOwner).toEqual({
      ownerId: 'u1',
      kind: 'PROFESSIONAL',
      academiaId: null,
    });
  });

  it('UT-021 the guard refuses anyone who is not a billing owner with 403 not_billing_owner', async () => {
    const student = subject({
      product: { type: ProductType.USER, tier: ProductTier.FREE },
    });
    const guard = new BillingOwnerGuard(users(student), owners);
    await expect(
      guard.canActivate(contextOf({ user: { id: 'u1' } })),
    ).rejects.toMatchObject({ status: 403, code: 'not_billing_owner' });

    const missing = new BillingOwnerGuard(users(null), owners);
    await expect(
      missing.canActivate(contextOf({ user: { id: 'gone' } })),
    ).rejects.toMatchObject({ status: 403, code: 'not_billing_owner' });
  });

  it('UT-022 the plan guard asks professionals for Premium and gym owners for a subscription', async () => {
    const standard = subject({
      product: {
        type: ProductType.PHYSICAL_EDUCATOR,
        tier: ProductTier.STANDARD,
      },
    });
    await expect(
      new BillingPlanGuard(users(standard), owners).canActivate(
        contextOf({ user: { id: 'u1' } }),
      ),
    ).rejects.toMatchObject({ status: 403, code: 'premium_required' });

    const lapsedGym = subject({
      academiaId: 'a1',
      subscriptionStatus: 'canceled',
      product: { type: ProductType.ACADEMIA, tier: ProductTier.STANDARD },
    });
    await expect(
      new BillingPlanGuard(users(lapsedGym), owners).canActivate(
        contextOf({ user: { id: 'u1' } }),
      ),
    ).rejects.toMatchObject({ status: 403, code: 'subscription_required' });

    await expect(
      new BillingPlanGuard(users(subject()), owners).canActivate(
        contextOf({ user: { id: 'u1' } }),
      ),
    ).resolves.toBe(true);
  });
});
