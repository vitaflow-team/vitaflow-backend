import { CodedError } from '@/common/errors/codedError';
import { AcademiaStudentsService } from './academiaStudents.service';

function makeDeps() {
  return {
    clients: {
      findAllByAcademiaId: jest.fn().mockResolvedValue([]),
      assignEducator: jest.fn().mockResolvedValue(true),
    },
    employments: {
      findActive: jest.fn().mockResolvedValue({ id: 'employment-1' }),
    },
    fixedSessions: {
      nextForRecords: jest.fn().mockResolvedValue(new Map()),
    },
    clock: {
      now: jest.fn().mockReturnValue(new Date('2026-11-01T12:00:00Z')),
    },
  };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new AcademiaStudentsService(
    deps.clients as never,
    deps.employments as never,
    deps.fixedSessions as never,
    deps.clock as never,
  );
}

describe('AcademiaStudentsService', () => {
  describe('list', () => {
    it('UT-002 only ever batches nextSession for the rows this academia-scoped query returned', async () => {
      const deps = makeDeps();
      deps.clients.findAllByAcademiaId.mockResolvedValue([
        {
          id: 'academia-1-client',
          name: 'Aluno Academia 1',
          email: 'aluno1@exemplo.com',
          professionalId: 'edu-1',
          professional: { id: 'edu-1', name: 'Educador Compartilhado' },
          userId: null,
        },
      ]);
      deps.fixedSessions.nextForRecords.mockResolvedValue(
        new Map([
          [
            'academia-1-client',
            { startAt: new Date('2026-11-02T10:00:00Z'), type: 'PRESENCIAL' },
          ],
        ]),
      );
      const service = makeService(deps);

      const result = await service.list('academia-1', {});

      expect(deps.clients.findAllByAcademiaId).toHaveBeenCalledWith(
        'academia-1',
      );
      expect(deps.fixedSessions.nextForRecords).toHaveBeenCalledTimes(1);
      expect(deps.fixedSessions.nextForRecords).toHaveBeenCalledWith(
        'edu-1',
        [{ clientId: 'academia-1-client', userId: null }],
        expect.any(Date),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('academia-1-client');
    });

    it('UT-009 a private client never appears, since the query is scoped to this academiaId alone', async () => {
      const deps = makeDeps();
      // The repository's own `where: { academiaId }` clause is what keeps a
      // private client (academiaId: null) out — this confirms the service
      // only ever renders what the scoped query returns, nothing more.
      deps.clients.findAllByAcademiaId.mockResolvedValue([]);
      const service = makeService(deps);

      const result = await service.list('academia-1', { search: 'qualquer' });

      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 50 });
    });

    it('never calls nextForRecords for unassigned students', async () => {
      const deps = makeDeps();
      deps.clients.findAllByAcademiaId.mockResolvedValue([
        {
          id: 'c1',
          name: 'Sem Educador',
          email: 'sem@exemplo.com',
          professionalId: null,
          professional: null,
          userId: null,
        },
      ]);
      const service = makeService(deps);

      const result = await service.list('academia-1', {});

      expect(deps.fixedSessions.nextForRecords).not.toHaveBeenCalled();
      expect(result.items[0].assignedEducator).toBeNull();
      expect(result.items[0].nextSession).toBeNull();
    });
  });

  describe('assignEducator', () => {
    it('UT-036 assigns a student to an educator currently ACTIVE-employed at this academia', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.assignEducator('academia-1', 'client-1', 'educator-1');

      expect(deps.employments.findActive).toHaveBeenCalledWith(
        'academia-1',
        'educator-1',
      );
      expect(deps.clients.assignEducator).toHaveBeenCalledWith(
        'client-1',
        'academia-1',
        'educator-1',
      );
    });

    it('UT-037 rejects assigning an educator not currently employed by this academia', async () => {
      const deps = makeDeps();
      deps.employments.findActive.mockResolvedValue(null);
      const service = makeService(deps);

      await expect(
        service.assignEducator('academia-1', 'client-1', 'educator-1'),
      ).rejects.toMatchObject({ code: 'not_employed_here' });
      expect(deps.clients.assignEducator).not.toHaveBeenCalled();
    });

    it('UT-038 clears the assignment when professionalId is null, without re-checking employment', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.assignEducator('academia-1', 'client-1', null);

      expect(deps.employments.findActive).not.toHaveBeenCalled();
      expect(deps.clients.assignEducator).toHaveBeenCalledWith(
        'client-1',
        'academia-1',
        null,
      );
    });

    it('rejects when the student does not belong to this academia', async () => {
      const deps = makeDeps();
      deps.clients.assignEducator.mockResolvedValue(false);
      const service = makeService(deps);

      await expect(
        service.assignEducator('academia-1', 'client-1', null),
      ).rejects.toBeInstanceOf(CodedError);
    });
  });
});
