import { StudentAccessPlanService } from './studentAccessPlan.service';

const NOW = new Date('2026-11-15T15:00:00Z');

function catalogPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'catalog-1',
    academiaId: 'academia-1',
    name: 'Mensal',
    validityType: 'DAYS',
    validityValue: 30,
    referencePrice: 100,
    active: true,
    ...overrides,
  };
}

function makeDeps() {
  return {
    plans: {
      create: jest
        .fn()
        .mockImplementation((data) =>
          Promise.resolve({ id: 'plan-1', status: 'ARCHIVED', ...data }),
        ),
      activate: jest.fn().mockResolvedValue(true),
      findById: jest.fn().mockImplementation((id) =>
        Promise.resolve({
          id,
          status: 'ACTIVE',
          validityType: 'DAYS',
          validityValue: 30,
        }),
      ),
      findActiveByClient: jest.fn().mockResolvedValue(null),
      findCheckInTimestampsSince: jest.fn().mockResolvedValue([]),
    },
    catalog: {
      findById: jest.fn().mockResolvedValue(catalogPlan()),
    },
    clients: {
      getClientById: jest
        .fn()
        .mockResolvedValue({ id: 'client-1', academiaId: 'academia-1' }),
    },
    clock: { now: jest.fn().mockReturnValue(NOW) },
  };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new StudentAccessPlanService(
    deps.plans as never,
    deps.catalog as never,
    deps.clients as never,
    deps.clock as never,
  );
}

describe('StudentAccessPlanService', () => {
  describe('assign', () => {
    it('UT-007 assigns a plan to a student with none, snapshotting the catalog terms', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.assign('client-1', 'catalog-1');

      expect(deps.plans.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-1',
          accessPlanId: 'catalog-1',
          validityType: 'DAYS',
          validityValue: 30,
          referencePrice: 100,
        }),
      );
      expect(deps.plans.activate).toHaveBeenCalledWith('client-1', 'plan-1');
    });

    it('UT-008 assigning a different plan replaces the active one via activate()', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.assign('client-1', 'catalog-2');

      expect(deps.plans.activate).toHaveBeenCalledTimes(1);
    });

    it('UT-009 re-assigning the same plan is a renewal, not a no-op — a fresh row is created and activated', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.assign('client-1', 'catalog-1');
      await service.assign('client-1', 'catalog-1');

      expect(deps.plans.create).toHaveBeenCalledTimes(2);
      expect(deps.plans.activate).toHaveBeenCalledTimes(2);
    });

    it('computes expiresAt for a DAYS plan, null for a VISITS plan', async () => {
      const deps = makeDeps();
      const service = makeService(deps);
      await service.assign('client-1', 'catalog-1');
      expect(deps.plans.create).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt: expect.any(Date) }),
      );

      deps.catalog.findById.mockResolvedValue(
        catalogPlan({ validityType: 'VISITS', validityValue: 10 }),
      );
      await service.assign('client-1', 'catalog-1');
      expect(deps.plans.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ expiresAt: null }),
      );
    });

    it('rejects a student that does not belong to any academia', async () => {
      const deps = makeDeps();
      deps.clients.getClientById.mockResolvedValue({
        id: 'client-1',
        academiaId: null,
      });
      const service = makeService(deps);

      await expect(
        service.assign('client-1', 'catalog-1'),
      ).rejects.toMatchObject({
        code: 'student_not_found',
      });
    });

    it("rejects a catalog plan not found at this student's academia", async () => {
      const deps = makeDeps();
      deps.catalog.findById.mockResolvedValue(null);
      const service = makeService(deps);

      await expect(
        service.assign('client-1', 'catalog-x'),
      ).rejects.toMatchObject({
        code: 'access_plan_not_found',
      });
    });
  });

  describe('currentForClient', () => {
    it('UT-011 a DAYS plan returns VALID/EXPIRED based on expiresAt, remaining null', async () => {
      const deps = makeDeps();
      deps.plans.findActiveByClient.mockResolvedValue({
        validityType: 'DAYS',
        expiresAt: new Date('2026-12-01T00:00:00Z'),
        assignedAt: new Date('2026-11-01T00:00:00Z'),
        validityValue: 30,
      });
      const service = makeService(deps);

      const valid = await service.currentForClient('client-1', NOW);
      expect(valid).toMatchObject({ status: 'VALID', remaining: null });

      deps.plans.findActiveByClient.mockResolvedValue({
        validityType: 'DAYS',
        expiresAt: new Date('2026-11-01T00:00:00Z'),
        assignedAt: new Date('2026-10-01T00:00:00Z'),
        validityValue: 30,
      });
      const expired = await service.currentForClient('client-1', NOW);
      expect(expired).toMatchObject({ status: 'EXPIRED', remaining: null });
    });

    it('UT-012 a VISITS plan computes remaining = validityValue - distinctCheckInDays', async () => {
      const deps = makeDeps();
      deps.plans.findActiveByClient.mockResolvedValue({
        validityType: 'VISITS',
        validityValue: 10,
        assignedAt: new Date('2026-11-01T00:00:00Z'),
      });
      deps.plans.findCheckInTimestampsSince.mockResolvedValue([
        new Date('2026-11-05T13:00:00Z'),
        new Date('2026-11-06T13:00:00Z'),
        new Date('2026-11-06T18:00:00Z'), // same BRT day, counts once
      ]);
      const service = makeService(deps);

      const result = await service.currentForClient('client-1', NOW);

      expect(result).toMatchObject({ status: 'VALID', remaining: 8 });
    });

    it('UT-013 a VISITS plan at or past capacity is EXHAUSTED, remaining <= 0', async () => {
      const deps = makeDeps();
      deps.plans.findActiveByClient.mockResolvedValue({
        validityType: 'VISITS',
        validityValue: 2,
        assignedAt: new Date('2026-11-01T00:00:00Z'),
      });
      deps.plans.findCheckInTimestampsSince.mockResolvedValue([
        new Date('2026-11-05T13:00:00Z'),
        new Date('2026-11-06T13:00:00Z'),
      ]);
      const service = makeService(deps);

      const result = await service.currentForClient('client-1', NOW);

      expect(result.status).toBe('EXHAUSTED');
      expect(result.remaining).toBeLessThanOrEqual(0);
    });

    it('no active plan returns NO_PLAN', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      const result = await service.currentForClient('client-1', NOW);

      expect(result).toEqual({
        plan: null,
        status: 'NO_PLAN',
        remaining: null,
      });
    });
  });

  it('UT-014 editing the catalog entry after assignment never changes an existing snapshot', async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.assign('client-1', 'catalog-1');
    const firstCall = deps.plans.create.mock.calls[0][0];

    deps.catalog.findById.mockResolvedValue(
      catalogPlan({ validityValue: 999, referencePrice: 9999 }),
    );
    await service.assign('client-1', 'catalog-1');
    const secondCall = deps.plans.create.mock.calls[1][0];

    expect(firstCall.validityValue).toBe(30);
    expect(secondCall.validityValue).toBe(999);
  });
});
