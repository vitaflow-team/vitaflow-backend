import { ReceptionistCheckInController } from './receptionistCheckin.controller';

function makeDeps() {
  return {
    clients: {
      findAllGymStudentNames: jest.fn().mockResolvedValue([
        { id: 'c1', name: 'Diego Martins' },
        { id: 'c2', name: 'Fernanda Álvares' },
      ]),
      getClientById: jest
        .fn()
        .mockResolvedValue({ id: 'c1', academiaId: 'academia-1' }),
    },
    checkIns: {
      register: jest.fn().mockResolvedValue({ id: 'checkin-1' }),
    },
  };
}

function makeController(deps: ReturnType<typeof makeDeps>) {
  return new ReceptionistCheckInController(
    deps.clients as never,
    deps.checkIns as never,
  );
}

const RECEPTIONIST = {
  user: {
    id: 'staff-1',
    academiaId: 'academia-1',
    role: 'RECEPTIONIST' as const,
  },
};

describe('ReceptionistCheckInController', () => {
  describe('search', () => {
    it('matches partial, case, and accent-insensitive', async () => {
      const deps = makeDeps();
      const controller = makeController(deps);

      const result = await controller.search('alvares', RECEPTIONIST);

      expect(result.map((r) => r.id)).toEqual(['c2']);
    });

    it('returns a clean empty array for a search matching nothing', async () => {
      const deps = makeDeps();
      const controller = makeController(deps);

      const result = await controller.search('zzz', RECEPTIONIST);

      expect(result).toEqual([]);
    });

    it('returns every student when no search term is given', async () => {
      const deps = makeDeps();
      const controller = makeController(deps);

      const result = await controller.search(undefined, RECEPTIONIST);

      expect(result).toHaveLength(2);
    });
  });

  describe('checkIn', () => {
    it('UT-002 registers a check-in with the staff id and RECEPTIONIST source', async () => {
      const deps = makeDeps();
      const controller = makeController(deps);

      await controller.checkIn('c1', RECEPTIONIST);

      expect(deps.checkIns.register).toHaveBeenCalledWith(
        'c1',
        'RECEPTIONIST',
        'staff-1',
      );
    });

    it('UT-022 refuses a clientId belonging to a different academia, even via a direct request', async () => {
      const deps = makeDeps();
      deps.clients.getClientById.mockResolvedValue({
        id: 'c1',
        academiaId: 'academia-2',
      });
      const controller = makeController(deps);

      await expect(
        controller.checkIn('c1', RECEPTIONIST),
      ).rejects.toMatchObject({
        code: 'student_not_found',
      });
      expect(deps.checkIns.register).not.toHaveBeenCalled();
    });

    it('UT-024 refuses a private client (academiaId: null), even by direct id', async () => {
      const deps = makeDeps();
      deps.clients.getClientById.mockResolvedValue({
        id: 'c1',
        academiaId: null,
      });
      const controller = makeController(deps);

      await expect(
        controller.checkIn('c1', RECEPTIONIST),
      ).rejects.toMatchObject({
        code: 'student_not_found',
      });
    });
  });
});
