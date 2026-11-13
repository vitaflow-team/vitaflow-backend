import { IndependentChurnRiskController } from './independentChurnRisk.controller';

const NOW = new Date('2026-11-15T12:00:00Z');

function makeDeps() {
  return {
    churnRisk: {
      dismissForClient: jest.fn().mockResolvedValue({ dismissed: 1 }),
    },
    clients: {
      getClientById: jest.fn(),
    },
    clock: { now: jest.fn().mockReturnValue(NOW) },
  };
}

function makeController(deps: ReturnType<typeof makeDeps>) {
  return new IndependentChurnRiskController(
    deps.churnRisk as never,
    deps.clients as never,
    deps.clock as never,
  );
}

function makeRequest(userId: string) {
  return { user: { id: userId } } as never;
}

describe('IndependentChurnRiskController.dismiss', () => {
  it('UT-028 dismisses the caller’s own private client, returning { dismissed: n }', async () => {
    const deps = makeDeps();
    deps.clients.getClientById.mockResolvedValue({
      id: 'client-1',
      professionalId: 'prof-1',
      academiaId: null,
    });
    const controller = makeController(deps);

    const result = await controller.dismiss('client-1', makeRequest('prof-1'));

    expect(deps.churnRisk.dismissForClient).toHaveBeenCalledWith(
      'client-1',
      NOW,
    );
    expect(result).toEqual({ dismissed: 1 });
  });

  it('UT-029 refuses a client belonging to a different professional with a 404 coded error', async () => {
    const deps = makeDeps();
    deps.clients.getClientById.mockResolvedValue({
      id: 'client-1',
      professionalId: 'someone-else',
      academiaId: null,
    });
    const controller = makeController(deps);

    await expect(
      controller.dismiss('client-1', makeRequest('prof-1')),
    ).rejects.toMatchObject({ status: 404, code: 'client_not_found' });
    expect(deps.churnRisk.dismissForClient).not.toHaveBeenCalled();
  });

  it('UT-030 refuses a gym-owned client even when professionalId matches the caller (an assigned educator)', async () => {
    const deps = makeDeps();
    deps.clients.getClientById.mockResolvedValue({
      id: 'client-1',
      professionalId: 'prof-1',
      academiaId: 'academia-1',
    });
    const controller = makeController(deps);

    await expect(
      controller.dismiss('client-1', makeRequest('prof-1')),
    ).rejects.toMatchObject({ status: 404, code: 'client_not_found' });
    expect(deps.churnRisk.dismissForClient).not.toHaveBeenCalled();
  });

  it('refuses a nonexistent client with the same 404 coded error', async () => {
    const deps = makeDeps();
    deps.clients.getClientById.mockResolvedValue(null);
    const controller = makeController(deps);

    await expect(
      controller.dismiss('missing', makeRequest('prof-1')),
    ).rejects.toMatchObject({ status: 404, code: 'client_not_found' });
  });
});
