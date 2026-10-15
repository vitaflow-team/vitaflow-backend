import { CheckInController } from './checkin.controller';

function makeDeps() {
  return {
    checkIns: {
      register: jest.fn().mockResolvedValue({ id: 'checkin-1' }),
    },
    clients: {
      findAcademiaOwnedByUserId: jest.fn().mockResolvedValue([]),
    },
  };
}

function makeController(deps: ReturnType<typeof makeDeps>) {
  return new CheckInController(deps.checkIns as never, deps.clients as never);
}

describe('CheckInController.eligibility', () => {
  it('reports eligible: true when an academia-owned Client row exists', async () => {
    const deps = makeDeps();
    deps.clients.findAcademiaOwnedByUserId.mockResolvedValue([
      { id: 'client-1', academiaId: 'academia-1' },
    ]);
    const controller = makeController(deps);

    const result = await controller.eligibility({ user: { id: 'user-1' } });

    expect(result).toEqual({ eligible: true });
  });

  it('UT-023 reports eligible: false for a user with no academia-owned Client row', async () => {
    const deps = makeDeps();
    const controller = makeController(deps);

    const result = await controller.eligibility({ user: { id: 'user-1' } });

    expect(result).toEqual({ eligible: false });
  });
});

describe('CheckInController.register', () => {
  it("checks in at the caller's own academia-owned Client row", async () => {
    const deps = makeDeps();
    deps.clients.findAcademiaOwnedByUserId.mockResolvedValue([
      { id: 'client-1', academiaId: 'academia-1' },
    ]);
    const controller = makeController(deps);

    await controller.register({ user: { id: 'user-1' } });

    expect(deps.checkIns.register).toHaveBeenCalledWith('client-1', 'SELF');
  });

  it('UT-023 refuses a user with no academia-owned Client row at all', async () => {
    const deps = makeDeps();
    const controller = makeController(deps);

    await expect(
      controller.register({ user: { id: 'user-1' } }),
    ).rejects.toMatchObject({ code: 'not_eligible' });
    expect(deps.checkIns.register).not.toHaveBeenCalled();
  });

  it('UT-024 a private client (no academia-owned row) is never eligible, even if the user has an unrelated educator relationship', async () => {
    const deps = makeDeps();
    // findAcademiaOwnedByUserId already excludes academiaId: null rows at the
    // repository query level — a private-only user resolves to an empty list.
    deps.clients.findAcademiaOwnedByUserId.mockResolvedValue([]);
    const controller = makeController(deps);

    await expect(
      controller.register({ user: { id: 'user-1' } }),
    ).rejects.toMatchObject({ code: 'not_eligible' });
  });
});
