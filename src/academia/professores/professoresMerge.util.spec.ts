import {
  mergeProfessoresList,
  type ActiveEmployeeCandidate,
  type PendingInvitationCandidate,
} from './professoresMerge.util';

function active(
  overrides: Partial<ActiveEmployeeCandidate> = {},
): ActiveEmployeeCandidate {
  return {
    id: 'employment-1',
    educatorId: 'educator-1',
    name: 'Ana Souza',
    email: 'ana@exemplo.com',
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function pending(
  overrides: Partial<PendingInvitationCandidate> = {},
): PendingInvitationCandidate {
  return {
    id: 'invitation-1',
    educatorId: null,
    matchedName: null,
    email: 'convidado@exemplo.com',
    ...overrides,
  };
}

describe('mergeProfessoresList', () => {
  it('UT-001 merges one active and one pending row, sorted by name, each tagged with its status', () => {
    const result = mergeProfessoresList({
      active: [active({ name: 'Bruno Lima' })],
      pending: [pending({ matchedName: 'Ana Costa' })],
      studentCounts: new Map(),
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.name)).toEqual([
      'Ana Costa',
      'Bruno Lima',
    ]);
    expect(result.items.map((item) => item.status)).toEqual([
      'PENDING',
      'ACTIVE',
    ]);
  });

  it('UT-002 a search term matches only the active row by name, a different term matches only the pending row by email', () => {
    const active1 = active({ name: 'Diego Martins', email: 'diego@x.com' });
    const pending1 = pending({ email: 'carla@exemplo.com' });

    const byName = mergeProfessoresList({
      active: [active1],
      pending: [pending1],
      studentCounts: new Map(),
      search: 'diego',
      page: 1,
      pageSize: 10,
    });
    expect(byName.items).toHaveLength(1);
    expect(byName.items[0].status).toBe('ACTIVE');

    const byEmail = mergeProfessoresList({
      active: [active1],
      pending: [pending1],
      studentCounts: new Map(),
      search: 'carla',
      page: 1,
      pageSize: 10,
    });
    expect(byEmail.items).toHaveLength(1);
    expect(byEmail.items[0].status).toBe('PENDING');
  });

  it('UT-003 matches a search term that differs only by accent/case', () => {
    const result = mergeProfessoresList({
      active: [active({ name: 'João Pereira' })],
      pending: [],
      studentCounts: new Map(),
      search: 'joao',
      page: 1,
      pageSize: 10,
    });

    expect(result.items).toHaveLength(1);
  });

  it('UT-004 a search term matching nothing returns an empty, distinguishable result', () => {
    const result = mergeProfessoresList({
      active: [active()],
      pending: [pending()],
      studentCounts: new Map(),
      search: 'zzz-no-match',
      page: 1,
      pageSize: 10,
    });

    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 10 });
  });

  it('UT-005 attaches the correct per-educator student count, zero for pending and for an educator with none', () => {
    const result = mergeProfessoresList({
      active: [
        active({ educatorId: 'e1', name: 'Com Alunos' }),
        active({ educatorId: 'e2', name: 'Sem Alunos' }),
      ],
      pending: [pending()],
      studentCounts: new Map([['e1', 5]]),
      page: 1,
      pageSize: 10,
    });

    const byName = new Map(result.items.map((item) => [item.name, item]));
    expect(byName.get('Com Alunos')?.academiaStudentCount).toBe(5);
    expect(byName.get('Sem Alunos')?.academiaStudentCount).toBe(0);
    expect(
      result.items.find((item) => item.status === 'PENDING')
        ?.academiaStudentCount,
    ).toBe(0);
  });

  it('UT-006 paginates a merged set correctly, with no off-by-one at the boundary', () => {
    const rows = ['A', 'B', 'C', 'D', 'E'].map((name) =>
      active({ educatorId: name, name, email: `${name.toLowerCase()}@x.com` }),
    );

    const page2 = mergeProfessoresList({
      active: rows,
      pending: [],
      studentCounts: new Map(),
      page: 2,
      pageSize: 2,
    });

    expect(page2.total).toBe(5);
    expect(page2.items.map((item) => item.name)).toEqual(['C', 'D']);
  });

  it('UT-007 never renders a DECLINED or CANCELLED invitation — the merge receives only PENDING candidates', () => {
    const result = mergeProfessoresList({
      active: [],
      pending: [pending({ id: 'p1' })],
      studentCounts: new Map(),
      page: 1,
      pageSize: 10,
    });

    expect(result.items).toEqual([
      {
        id: 'p1',
        name: null,
        email: 'convidado@exemplo.com',
        status: 'PENDING',
        startedAt: null,
        academiaStudentCount: 0,
      },
    ]);
  });

  it('UT-008 a pending invitation with no matched Users row renders name: null, never an error or omission', () => {
    const result = mergeProfessoresList({
      active: [],
      pending: [pending({ educatorId: null, matchedName: null })],
      studentCounts: new Map(),
      page: 1,
      pageSize: 10,
    });

    expect(result.items[0].name).toBeNull();
    expect(result.items[0].email).toBe('convidado@exemplo.com');
  });

  it('UT-009 isolation is the caller’s responsibility — this function only ever sees one academia’s rows', () => {
    const result = mergeProfessoresList({
      active: [active({ educatorId: 'own-educator' })],
      pending: [],
      studentCounts: new Map([['other-academia-educator', 99]]),
      page: 1,
      pageSize: 10,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].academiaStudentCount).toBe(0);
  });
});
