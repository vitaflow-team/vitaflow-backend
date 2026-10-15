import { PAINEL_ACTIVITY_LIMIT, PainelService } from './painel.service';

function educator(overrides: Record<string, unknown> = {}) {
  return {
    id: 'employment-1',
    academiaId: 'academia-1',
    educatorId: 'educator-1',
    status: 'ACTIVE',
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    endedAt: null,
    educator: { id: 'educator-1', name: 'Ana', email: 'ana@exemplo.com' },
    ...overrides,
  };
}

function notification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notif-1',
    message: 'Educador convidado: ana@exemplo.com',
    createdAt: new Date('2026-10-14T10:00:00.000Z'),
    ...overrides,
  };
}

function makeDeps() {
  return {
    clients: {
      countByAcademiaId: jest.fn().mockResolvedValue(0),
    },
    employments: {
      listActiveByAcademia: jest.fn().mockResolvedValue([]),
    },
    notifications: {
      findRecentByUserAndCategory: jest.fn().mockResolvedValue([]),
    },
  };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new PainelService(
    deps.clients as never,
    deps.employments as never,
    deps.notifications as never,
  );
}

describe('PainelService', () => {
  it('UT-050 counts only Client rows scoped to this academiaId, never a private client', async () => {
    const deps = makeDeps();
    deps.clients.countByAcademiaId.mockResolvedValue(3);
    deps.employments.listActiveByAcademia.mockResolvedValue([educator()]);
    const service = makeService(deps);

    const result = await service.getPainel('academia-1', 'owner-1');

    expect(deps.clients.countByAcademiaId).toHaveBeenCalledWith('academia-1');
    expect(result.studentCount).toBe(3);
    expect(result.educatorCount).toBe(1);
  });

  it('UT-051 a freshly-provisioned academia returns explicit zero/empty markers, no omitted fields', async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    const result = await service.getPainel('academia-1', 'owner-1');

    expect(result).toEqual({
      educatorCount: 0,
      studentCount: 0,
      educators: [],
      activity: [],
    });
  });

  it('UT-052 activity feed items are ordered newest-first (delegated to the repository query)', async () => {
    const deps = makeDeps();
    const newest = notification({
      id: 'notif-2',
      createdAt: new Date('2026-10-14T12:00:00.000Z'),
    });
    const oldest = notification({
      id: 'notif-1',
      createdAt: new Date('2026-10-14T10:00:00.000Z'),
    });
    deps.notifications.findRecentByUserAndCategory.mockResolvedValue([
      newest,
      oldest,
    ]);
    const service = makeService(deps);

    const result = await service.getPainel('academia-1', 'owner-1');

    expect(result.activity.map((item) => item.id)).toEqual([
      'notif-2',
      'notif-1',
    ]);
  });

  it('UT-053 applies a bounded limit to the activity feed query regardless of accumulated volume', async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.getPainel('academia-1', 'owner-1');

    expect(deps.notifications.findRecentByUserAndCategory).toHaveBeenCalledWith(
      'owner-1',
      'ACADEMIA_ACTIVITY',
      PAINEL_ACTIVITY_LIMIT,
    );
  });

  it('UT-054 counts/lists are scoped by academiaId only — the repository query never mixes in professionalId-only (private) clients', async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.getPainel('academia-1', 'owner-1');

    expect(deps.clients.countByAcademiaId).toHaveBeenCalledWith('academia-1');
    expect(deps.clients.countByAcademiaId).not.toHaveBeenCalledWith(undefined);
  });
});
