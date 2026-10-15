import { CheckInService } from './checkin.service';

function makeDeps() {
  return {
    checkIns: {
      create: jest
        .fn()
        .mockImplementation((data) =>
          Promise.resolve({ id: 'checkin-1', ...data }),
        ),
    },
    accessPlans: {
      currentForClient: jest
        .fn()
        .mockResolvedValue({ plan: null, status: 'NO_PLAN', remaining: null }),
    },
    clock: { now: jest.fn().mockReturnValue(new Date('2026-11-15T15:00:00Z')) },
  };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new CheckInService(
    deps.checkIns as never,
    deps.accessPlans as never,
    deps.clock as never,
  );
}

describe('CheckInService.register', () => {
  it('UT-001 self-service check-in with no plan assigned snapshots planValidAtCheckIn: true', async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    const result = await service.register('client-1', 'SELF');

    expect(result).toMatchObject({ source: 'SELF', planValidAtCheckIn: true });
    expect(deps.checkIns.create).toHaveBeenCalledWith({
      clientId: 'client-1',
      source: 'SELF',
      registeredByStaffId: null,
      planValidAtCheckIn: true,
    });
  });

  it('UT-002 receptionist check-in records the staff id and source', async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.register('client-1', 'RECEPTIONIST', 'staff-1');

    expect(deps.checkIns.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'RECEPTIONIST',
        registeredByStaffId: 'staff-1',
      }),
    );
  });

  it('UT-003 a plan within validity snapshots true', async () => {
    const deps = makeDeps();
    deps.accessPlans.currentForClient.mockResolvedValue({
      plan: {},
      status: 'VALID',
      remaining: null,
    });
    const service = makeService(deps);

    await service.register('client-1', 'SELF');

    expect(deps.checkIns.create).toHaveBeenCalledWith(
      expect.objectContaining({ planValidAtCheckIn: true }),
    );
  });

  it('UT-004 a DAYS plan past expiresAt still creates the check-in, snapshotting false', async () => {
    const deps = makeDeps();
    deps.accessPlans.currentForClient.mockResolvedValue({
      plan: {},
      status: 'EXPIRED',
      remaining: null,
    });
    const service = makeService(deps);

    const result = await service.register('client-1', 'SELF');

    expect(result).toBeDefined();
    expect(deps.checkIns.create).toHaveBeenCalledWith(
      expect.objectContaining({ planValidAtCheckIn: false }),
    );
  });

  it('UT-005 a VISITS plan with zero remaining still creates the check-in, snapshotting false', async () => {
    const deps = makeDeps();
    deps.accessPlans.currentForClient.mockResolvedValue({
      plan: {},
      status: 'EXHAUSTED',
      remaining: 0,
    });
    const service = makeService(deps);

    const result = await service.register('client-1', 'SELF');

    expect(result).toBeDefined();
    expect(deps.checkIns.create).toHaveBeenCalledWith(
      expect.objectContaining({ planValidAtCheckIn: false }),
    );
  });

  it('UT-006 a second check-in on the same BRT day is never refused, both rows created', async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.register('client-1', 'SELF');
    await service.register('client-1', 'RECEPTIONIST', 'staff-1');

    expect(deps.checkIns.create).toHaveBeenCalledTimes(2);
  });
});
