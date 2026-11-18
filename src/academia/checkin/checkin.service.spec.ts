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
    notices: { noticeFor: jest.fn().mockResolvedValue(null) },
  };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new CheckInService(
    deps.checkIns as never,
    deps.accessPlans as never,
    deps.clock as never,
    deps.notices as never,
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

describe('CheckInService.registerByReceptionist', () => {
  const STAFF = { id: 'staff-1', academiaId: 'academia-1' };

  it('UT-092 the self check-in result is the plain check-in row, with no notice property', async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    const result = await service.register('client-1', 'SELF');

    expect(result).not.toHaveProperty('notice');
    expect(deps.notices.noticeFor).not.toHaveBeenCalled();
  });

  it('UT-093 the receptionist response has exactly id, createdAt and notice, and no financial word', async () => {
    const deps = makeDeps();
    deps.notices.noticeFor.mockResolvedValue('SEE_ADMINISTRATION');
    const service = makeService(deps);

    const result = await service.registerByReceptionist('client-1', STAFF);

    expect(Object.keys(result)).toEqual(['id', 'createdAt', 'notice']);
    expect(result.notice).toBe('SEE_ADMINISTRATION');
    const json = JSON.stringify(result).toLowerCase();
    for (const word of ['amount', 'cents', 'days', 'owed']) {
      expect(json).not.toContain(word);
    }
    expect(deps.checkIns.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'RECEPTIONIST',
        registeredByStaffId: 'staff-1',
      }),
    );
  });

  it('UT-095 two check-ins on the same day are both recorded and both carry the notice', async () => {
    const deps = makeDeps();
    deps.notices.noticeFor.mockResolvedValue('SEE_ADMINISTRATION');
    const service = makeService(deps);

    const first = await service.registerByReceptionist('client-1', STAFF);
    const second = await service.registerByReceptionist('client-1', STAFF);

    expect(deps.checkIns.create).toHaveBeenCalledTimes(2);
    expect([first.notice, second.notice]).toEqual([
      'SEE_ADMINISTRATION',
      'SEE_ADMINISTRATION',
    ]);
  });

  it('records the check-in before it looks the notice up', async () => {
    const deps = makeDeps();
    const order: string[] = [];
    deps.checkIns.create.mockImplementation(() => {
      order.push('create');
      return Promise.resolve({ id: 'checkin-1', createdAt: new Date() });
    });
    deps.notices.noticeFor.mockImplementation(() => {
      order.push('notice');
      return Promise.resolve(null);
    });

    await makeService(deps).registerByReceptionist('client-1', STAFF);

    expect(order).toEqual(['create', 'notice']);
  });
});
