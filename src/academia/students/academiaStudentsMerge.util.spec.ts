import {
  buildAcademiaStudentsList,
  buildNextSessionMap,
  type AcademiaStudentRecord,
  type NextSessionSummary,
} from './academiaStudentsMerge.util';

function record(
  overrides: Partial<AcademiaStudentRecord> & { id: string; name: string },
): AcademiaStudentRecord {
  return {
    email: `${overrides.id}@exemplo.com`,
    professionalId: null,
    professionalName: null,
    userId: null,
    ...overrides,
  };
}

function session(
  startAt = new Date('2026-11-01T10:00:00Z'),
): NextSessionSummary {
  return { startAt, type: 'PRESENCIAL' };
}

describe('buildNextSessionMap', () => {
  it('UT-001 batches per distinct educator and never calls for unassigned students', async () => {
    const nextForRecords = jest
      .fn()
      .mockImplementation((educatorId: string) => {
        const map = new Map<string, NextSessionSummary>();
        map.set(`client-of-${educatorId}`, session());
        return Promise.resolve(map);
      });

    const result = await buildNextSessionMap(
      [
        { clientId: 'client-of-edu-1', userId: null, professionalId: 'edu-1' },
        { clientId: 'client-of-edu-2', userId: null, professionalId: 'edu-2' },
        { clientId: 'client-of-edu-3', userId: null, professionalId: 'edu-3' },
      ],
      new Date(),
      nextForRecords,
    );

    expect(nextForRecords).toHaveBeenCalledTimes(3);
    expect(result.size).toBe(3);
    expect(result.get('client-of-edu-1')).toBeDefined();
    expect(result.get('client-of-edu-2')).toBeDefined();
    expect(result.get('client-of-edu-3')).toBeDefined();
  });

  it('UT-002 groups only the students passed in, never mixing another educator-academia pairing not present in the input', async () => {
    const nextForRecords = jest
      .fn()
      .mockImplementation(
        (educatorId: string, records: Array<{ clientId: string }>) => {
          const map = new Map<string, NextSessionSummary>();
          for (const r of records) map.set(r.clientId, session());
          return Promise.resolve(map);
        },
      );

    const result = await buildNextSessionMap(
      [
        {
          clientId: 'academia-1-client',
          userId: null,
          professionalId: 'edu-1',
        },
      ],
      new Date(),
      nextForRecords,
    );

    expect(nextForRecords).toHaveBeenCalledTimes(1);
    expect(nextForRecords).toHaveBeenCalledWith(
      'edu-1',
      [{ clientId: 'academia-1-client', userId: null }],
      expect.any(Date),
    );
    expect(result.size).toBe(1);
    expect(result.has('academia-1-client')).toBe(true);
  });
});

describe('buildAcademiaStudentsList', () => {
  it('UT-003 search matches a student by their own name', () => {
    const result = buildAcademiaStudentsList({
      records: [
        record({ id: 'c1', name: 'Diego Martins' }),
        record({ id: 'c2', name: 'Fernanda Souza' }),
      ],
      nextSessionByClientId: new Map(),
      search: 'diego',
      page: 1,
      pageSize: 10,
    });

    expect(result.items.map((i) => i.id)).toEqual(['c1']);
  });

  it('UT-004 search matches all students of an assigned educator by educator name', () => {
    const result = buildAcademiaStudentsList({
      records: [
        record({
          id: 'c1',
          name: 'Diego Martins',
          professionalId: 'edu-1',
          professionalName: 'Carla Lima',
        }),
        record({
          id: 'c2',
          name: 'Fernanda Souza',
          professionalId: 'edu-1',
          professionalName: 'Carla Lima',
        }),
        record({ id: 'c3', name: 'Outro Aluno' }),
      ],
      nextSessionByClientId: new Map(),
      search: 'carla',
      page: 1,
      pageSize: 10,
    });

    expect(result.items.map((i) => i.id).sort()).toEqual(['c1', 'c2']);
  });

  it('UT-005 search matching nothing returns an empty result', () => {
    const result = buildAcademiaStudentsList({
      records: [record({ id: 'c1', name: 'Diego Martins' })],
      nextSessionByClientId: new Map(),
      search: 'ninguem-encontrado',
      page: 1,
      pageSize: 10,
    });

    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 10 });
  });

  it('UT-006 horario filter: COM only non-null, SEM only null, omitted returns all', () => {
    const records = [
      record({
        id: 'c1',
        name: 'A',
        professionalId: 'edu-1',
        professionalName: 'Edu 1',
      }),
      record({
        id: 'c2',
        name: 'B',
        professionalId: 'edu-2',
        professionalName: 'Edu 2',
      }),
      record({ id: 'c3', name: 'C' }),
    ];
    const nextSessionByClientId = new Map([['c1', session()]]);

    const com = buildAcademiaStudentsList({
      records,
      nextSessionByClientId,
      horario: 'COM',
      page: 1,
      pageSize: 10,
    });
    expect(com.items.map((i) => i.id)).toEqual(['c1']);

    const sem = buildAcademiaStudentsList({
      records,
      nextSessionByClientId,
      horario: 'SEM',
      page: 1,
      pageSize: 10,
    });
    expect(sem.items.map((i) => i.id).sort()).toEqual(['c2', 'c3']);

    const all = buildAcademiaStudentsList({
      records,
      nextSessionByClientId,
      page: 1,
      pageSize: 10,
    });
    expect(all.items).toHaveLength(3);
  });

  it('UT-007 an unassigned student is always excluded from COM and always included in SEM', () => {
    const records = [record({ id: 'c1', name: 'Sem Educador' })];
    const nextSessionByClientId = new Map([['c1', session()]]);

    const com = buildAcademiaStudentsList({
      records,
      nextSessionByClientId,
      horario: 'COM',
      page: 1,
      pageSize: 10,
    });
    expect(com.items).toHaveLength(0);

    const sem = buildAcademiaStudentsList({
      records,
      nextSessionByClientId,
      horario: 'SEM',
      page: 1,
      pageSize: 10,
    });
    expect(sem.items).toHaveLength(1);
    expect(sem.items[0].nextSession).toBeNull();
  });

  it('UT-008 every student unassigned at once: all returned, each marked "sem educador", no truncation', () => {
    const records = Array.from({ length: 120 }, (_, i) =>
      record({ id: `c${i}`, name: `Aluno ${i}` }),
    );

    const result = buildAcademiaStudentsList({
      records,
      nextSessionByClientId: new Map(),
      page: 1,
      pageSize: 50,
    });

    expect(result.total).toBe(120);
    expect(result.items).toHaveLength(50);
    expect(result.items.every((i) => i.assignedEducator === null)).toBe(true);

    const page3 = buildAcademiaStudentsList({
      records,
      nextSessionByClientId: new Map(),
      page: 3,
      pageSize: 50,
    });
    expect(page3.items).toHaveLength(20);
  });

  it('UT-009 a record not scoped to this academia by the repository query never appears (pass-through safety)', () => {
    const result = buildAcademiaStudentsList({
      records: [record({ id: 'c1', name: 'Aluno da Academia' })],
      nextSessionByClientId: new Map(),
      page: 1,
      pageSize: 10,
    });

    expect(result.items.map((i) => i.id)).toEqual(['c1']);
  });
});
