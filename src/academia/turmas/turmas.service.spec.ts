import { CodedError } from '@/common/errors/codedError';
import { TurmasService } from './turmas.service';

const NOW = new Date('2026-11-01T12:00:00Z');

function makeDeps() {
  const turma = {
    id: 'turma-1',
    academiaId: 'academia-1',
    name: 'Spinning',
    professionalId: null as string | null,
    weekday: 2,
    startMinute: 600,
    durationMinutes: 60,
    capacity: 10,
    removedAt: null,
  };

  return {
    turmas: {
      create: jest
        .fn()
        .mockImplementation((data) => Promise.resolve({ ...turma, ...data })),
      findLiveById: jest.fn().mockResolvedValue(turma),
      update: jest
        .fn()
        .mockImplementation((_id, data) =>
          Promise.resolve({ ...turma, ...data }),
        ),
      assignEducator: jest
        .fn()
        .mockImplementation((_id, professionalId) =>
          Promise.resolve({ ...turma, professionalId }),
        ),
      softRemove: jest.fn().mockResolvedValue(true),
      findAllLiveByAcademia: jest.fn().mockResolvedValue([]),
      deleteFutureSessions: jest.fn().mockResolvedValue(undefined),
    },
    employments: {
      findActive: jest.fn().mockResolvedValue({ id: 'employment-1' }),
    },
    renewal: {
      materializeForTurma: jest
        .fn()
        .mockResolvedValue({ created: 0, skipped: 0 }),
    },
    clock: { now: jest.fn().mockReturnValue(NOW) },
    prisma: {
      $transaction: jest
        .fn()
        .mockImplementation((work: (tx: unknown) => unknown) => work({})),
    },
  };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new TurmasService(
    deps.turmas as never,
    deps.employments as never,
    deps.renewal as never,
    deps.clock as never,
    deps.prisma as never,
  );
}

const validInput = {
  academiaId: 'academia-1',
  name: 'Spinning',
  weekday: 2,
  startMinute: 600,
  durationMinutes: 60,
  capacity: 10,
};

describe('TurmasService', () => {
  describe('create', () => {
    it('UT-001 creates a turma with valid fields and no professionalId', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      const result = await service.create(validInput);

      expect(deps.turmas.create).toHaveBeenCalledWith(
        expect.objectContaining({ professionalId: null }),
      );
      expect(result.professionalId).toBeNull();
    });

    it('UT-002 rejects capacity <= 0', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await expect(
        service.create({ ...validInput, capacity: 0 }),
      ).rejects.toMatchObject({ code: 'turma_invalid_capacity' });
      expect(deps.turmas.create).not.toHaveBeenCalled();
    });

    it('UT-003 rejects weekday/startMinute/durationMinutes outside bounds', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await expect(
        service.create({ ...validInput, weekday: 8 }),
      ).rejects.toMatchObject({ code: 'turma_invalid_schedule' });
      expect(deps.turmas.create).not.toHaveBeenCalled();
    });

    it('UT-004 creates with an ACTIVE-employed professionalId', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.create({ ...validInput, professionalId: 'educator-1' });

      expect(deps.employments.findActive).toHaveBeenCalledWith(
        'academia-1',
        'educator-1',
      );
      expect(deps.turmas.create).toHaveBeenCalledWith(
        expect.objectContaining({ professionalId: 'educator-1' }),
      );
    });

    it('UT-005 rejects a non-employed professionalId', async () => {
      const deps = makeDeps();
      deps.employments.findActive.mockResolvedValue(null);
      const service = makeService(deps);

      await expect(
        service.create({ ...validInput, professionalId: 'educator-x' }),
      ).rejects.toMatchObject({ code: 'not_employed_here' });
      expect(deps.turmas.create).not.toHaveBeenCalled();
    });

    it('UT-006 two turmas with the same weekday/startMinute are both created, no conflict check', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.create(validInput);
      await service.create(validInput);

      expect(deps.turmas.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('update', () => {
    it('UT-007 editing name/capacity only never touches TurmaSession rows', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.update('turma-1', 'academia-1', {
        name: 'Nova',
        capacity: 12,
      });

      expect(deps.turmas.deleteFutureSessions).not.toHaveBeenCalled();
      expect(deps.renewal.materializeForTurma).not.toHaveBeenCalled();
      expect(deps.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('UT-008 editing weekday/startMinute/durationMinutes deletes and regenerates future sessions in the same call', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.update('turma-1', 'academia-1', { weekday: 3 });

      expect(deps.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(deps.turmas.deleteFutureSessions).toHaveBeenCalledWith(
        'turma-1',
        NOW,
        {},
      );
      expect(deps.renewal.materializeForTurma).toHaveBeenCalledTimes(1);
    });

    it('rejects an edit that would make the schedule invalid', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await expect(
        service.update('turma-1', 'academia-1', { durationMinutes: 1000 }),
      ).rejects.toMatchObject({ code: 'turma_invalid_schedule' });
    });
  });

  describe('assignEducator', () => {
    it('UT-009 assigns a professionalId to a turma that had none, clearing "sem responsável"', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      const result = await service.assignEducator(
        'turma-1',
        'academia-1',
        'educator-1',
      );

      expect(deps.employments.findActive).toHaveBeenCalledWith(
        'academia-1',
        'educator-1',
      );
      expect(result.professionalId).toBe('educator-1');
    });

    it('UT-010 clears the professionalId when given null, persisting "sem responsável"', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      const result = await service.assignEducator(
        'turma-1',
        'academia-1',
        null,
      );

      expect(deps.employments.findActive).not.toHaveBeenCalled();
      expect(result.professionalId).toBeNull();
    });

    it('rejects assigning a non-employed professionalId', async () => {
      const deps = makeDeps();
      deps.employments.findActive.mockResolvedValue(null);
      const service = makeService(deps);

      await expect(
        service.assignEducator('turma-1', 'academia-1', 'educator-x'),
      ).rejects.toMatchObject({ code: 'not_employed_here' });
    });
  });

  describe('remove', () => {
    it('UT-011 soft-removes a turma, leaving enrollments untouched', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.remove('turma-1', 'academia-1');

      expect(deps.turmas.softRemove).toHaveBeenCalledWith(
        'academia-1',
        'turma-1',
      );
    });

    it('UT-012 removing an already-removed turma is a no-op, never throws', async () => {
      const deps = makeDeps();
      deps.turmas.softRemove.mockResolvedValue(false);
      const service = makeService(deps);

      await expect(
        service.remove('turma-1', 'academia-1'),
      ).resolves.toBeUndefined();
    });
  });

  it('propagates a CodedError, never a generic Error, on an invalid schedule', async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await expect(
      service.create({ ...validInput, weekday: 0 }),
    ).rejects.toBeInstanceOf(CodedError);
  });
});
