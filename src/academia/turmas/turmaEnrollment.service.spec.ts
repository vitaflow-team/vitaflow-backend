import { CodedError } from '@/common/errors/codedError';
import { TurmaEnrollmentService } from './turmaEnrollment.service';

function turma(overrides: Record<string, unknown> = {}) {
  return {
    id: 'turma-1',
    academiaId: 'academia-1',
    professionalId: 'educator-1',
    weekday: 2,
    startMinute: 600,
    durationMinutes: 60,
    capacity: 2,
    removedAt: null,
    ...overrides,
  };
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    id: 'client-1',
    name: 'Diego Martins',
    email: 'diego@exemplo.com',
    userId: 'user-1',
    academiaId: 'academia-1',
    professionalId: null,
    ...overrides,
  };
}

function makeDeps() {
  return {
    enrollments: {
      withTurmaLock: jest
        .fn()
        .mockImplementation(
          async (_turmaId: string, work: (tx: unknown) => unknown) =>
            await work({}),
        ),
      findEnrollment: jest.fn().mockResolvedValue(null),
      countEnrollments: jest.fn().mockResolvedValue(0),
      createEnrollment: jest.fn().mockResolvedValue({ id: 'enrollment-1' }),
      deleteEnrollment: jest.fn().mockResolvedValue(undefined),
      findLiveTurmasByAcademiaIds: jest.fn().mockResolvedValue([]),
      findEnrolledTurmaIds: jest.fn().mockResolvedValue(new Set()),
    },
    turmas: {
      findLiveByIdAnyAcademia: jest.fn().mockResolvedValue(turma()),
      findLiveById: jest.fn().mockResolvedValue(turma()),
    },
    clients: {
      getClientById: jest.fn().mockResolvedValue(client()),
      findByUserAndAcademiaId: jest.fn().mockResolvedValue(client()),
      findAcademiaOwnedByUserId: jest.fn().mockResolvedValue([]),
    },
  };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new TurmaEnrollmentService(
    deps.enrollments as never,
    deps.turmas as never,
    deps.clients as never,
  );
}

describe('TurmaEnrollmentService', () => {
  describe('enroll', () => {
    it('UT-013 enrolls an eligible student when capacity is available', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.enroll('turma-1', 'client-1');

      expect(deps.enrollments.createEnrollment).toHaveBeenCalledWith(
        'turma-1',
        'client-1',
        {},
      );
    });

    it('UT-014 re-enrolling an already-enrolled student is a no-op, no duplicate', async () => {
      const deps = makeDeps();
      deps.enrollments.findEnrollment.mockResolvedValue({ id: 'existing' });
      const service = makeService(deps);

      await service.enroll('turma-1', 'client-1');

      expect(deps.enrollments.createEnrollment).not.toHaveBeenCalled();
    });

    it('UT-015 refuses enrollment at capacity with a typed turma_full error', async () => {
      const deps = makeDeps();
      deps.enrollments.countEnrollments.mockResolvedValue(2);
      const service = makeService(deps);

      await expect(service.enroll('turma-1', 'client-1')).rejects.toMatchObject(
        {
          code: 'turma_full',
        },
      );
      expect(deps.enrollments.createEnrollment).not.toHaveBeenCalled();
    });

    it('UT-016 locks on the turma before counting and inserting', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.enroll('turma-1', 'client-1');

      expect(deps.enrollments.withTurmaLock).toHaveBeenCalledWith(
        'turma-1',
        expect.any(Function),
      );
    });

    it("UT-017 refuses a private client even of the turma's own responsible educator", async () => {
      const deps = makeDeps();
      deps.clients.getClientById.mockResolvedValue(
        client({ academiaId: null, professionalId: 'educator-1' }),
      );
      const service = makeService(deps);

      await expect(service.enroll('turma-1', 'client-1')).rejects.toMatchObject(
        {
          code: 'not_eligible',
        },
      );
      expect(deps.enrollments.createEnrollment).not.toHaveBeenCalled();
    });

    it("UT-018 refuses a gym student of a different academia than the turma's", async () => {
      const deps = makeDeps();
      deps.clients.getClientById.mockResolvedValue(
        client({ academiaId: 'academia-2' }),
      );
      const service = makeService(deps);

      await expect(service.enroll('turma-1', 'client-1')).rejects.toMatchObject(
        {
          code: 'not_eligible',
        },
      );
    });
  });

  describe('cancel', () => {
    it('UT-019 cancels an active enrollment, hard-deleted', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.cancel('turma-1', 'client-1');

      expect(deps.enrollments.deleteEnrollment).toHaveBeenCalledWith(
        'turma-1',
        'client-1',
      );
    });

    it('UT-020 cancelling an already-cancelled/non-existent enrollment is a no-op', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await expect(
        service.cancel('turma-1', 'client-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('enrollManual', () => {
    it('UT-021 an owner manually enrolling an eligible student reaches the identical state as self-service', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.enrollManual('academia-1', 'turma-1', 'client-1');

      expect(deps.enrollments.createEnrollment).toHaveBeenCalledWith(
        'turma-1',
        'client-1',
        {},
      );
    });

    it('UT-022 refuses manual enrollment of a private/cross-academia client, same rule as self-service', async () => {
      const deps = makeDeps();
      deps.clients.getClientById.mockResolvedValue(
        client({ academiaId: null }),
      );
      const service = makeService(deps);

      await expect(
        service.enrollManual('academia-1', 'turma-1', 'client-1'),
      ).rejects.toMatchObject({ code: 'not_eligible' });
    });

    it('UT-023 refuses manual enrollment into a full turma with the same "turma cheia" message', async () => {
      const deps = makeDeps();
      deps.enrollments.countEnrollments.mockResolvedValue(2);
      const service = makeService(deps);

      await expect(
        service.enrollManual('academia-1', 'turma-1', 'client-1'),
      ).rejects.toMatchObject({ code: 'turma_full' });
    });

    it('rejects manual enrollment into a turma that does not belong to this academia', async () => {
      const deps = makeDeps();
      deps.turmas.findLiveById.mockResolvedValue(null);
      const service = makeService(deps);

      await expect(
        service.enrollManual('academia-1', 'turma-1', 'client-1'),
      ).rejects.toMatchObject({ code: 'turma_not_found' });
      expect(deps.enrollments.withTurmaLock).not.toHaveBeenCalled();
    });
  });

  describe('listForStudent', () => {
    it('UT-024 a user with Client rows at 2 academias sees eligible turmas from both, each flagged enrolled true/false', async () => {
      const deps = makeDeps();
      deps.clients.findAcademiaOwnedByUserId.mockResolvedValue([
        client({ id: 'client-1', academiaId: 'academia-1' }),
        client({ id: 'client-2', academiaId: 'academia-2' }),
      ]);
      deps.enrollments.findLiveTurmasByAcademiaIds.mockResolvedValue([
        {
          ...turma({ id: 'turma-1', academiaId: 'academia-1' }),
          professional: null,
          academia: { id: 'academia-1', name: 'Academia A' },
          _count: { enrollments: 1 },
        },
        {
          ...turma({ id: 'turma-2', academiaId: 'academia-2' }),
          professional: { id: 'educator-2', name: 'Carla Lima' },
          academia: { id: 'academia-2', name: 'Academia B' },
          _count: { enrollments: 0 },
        },
      ]);
      deps.enrollments.findEnrolledTurmaIds.mockResolvedValue(
        new Set(['turma-1']),
      );
      const service = makeService(deps);

      const result = await service.listForStudent('user-1');

      expect(deps.enrollments.findLiveTurmasByAcademiaIds).toHaveBeenCalledWith(
        expect.arrayContaining(['academia-1', 'academia-2']),
      );
      expect(result).toEqual([
        expect.objectContaining({ id: 'turma-1', enrolled: true }),
        expect.objectContaining({ id: 'turma-2', enrolled: false }),
      ]);
    });
  });

  it('propagates a CodedError, never a generic Error, when a turma does not exist', async () => {
    const deps = makeDeps();
    deps.turmas.findLiveByIdAnyAcademia.mockResolvedValue(null);
    const service = makeService(deps);

    await expect(service.enroll('turma-1', 'client-1')).rejects.toBeInstanceOf(
      CodedError,
    );
  });
});
