import {
  DirectoryReceptionistCandidate,
  DirectoryUserCandidate,
  mergeDirectoryResults,
} from './backofficeDirectoryMerge.util';

function user(
  overrides: Partial<DirectoryUserCandidate> = {},
): DirectoryUserCandidate {
  return {
    id: 'user-1',
    name: 'Ana',
    email: 'ana@example.com',
    productType: 'USER',
    ...overrides,
  };
}

function receptionist(
  overrides: Partial<DirectoryReceptionistCandidate> = {},
): DirectoryReceptionistCandidate {
  return {
    id: 'staff-1',
    name: 'Recepção',
    email: 'recepcao@academia.test',
    ...overrides,
  };
}

describe('mergeDirectoryResults — platform-admin-access UT-001 through UT-006', () => {
  it('UT-001: every base product type maps to its own kind', () => {
    const result = mergeDirectoryResults({
      users: [
        user({ id: 'u', productType: 'USER' }),
        user({ id: 'n', productType: 'NUTRITIONIST' }),
        user({ id: 'p', productType: 'PHYSICAL_EDUCATOR' }),
      ],
      receptionists: [],
      page: 1,
      pageSize: 50,
    });

    const byId = Object.fromEntries(result.items.map((i) => [i.id, i.kind]));
    expect(byId.u).toBe('USER');
    expect(byId.n).toBe('NUTRITIONIST');
    expect(byId.p).toBe('PHYSICAL_EDUCATOR');
  });

  it('UT-002: type filter ACADEMIA returns both the owner and any receptionists, each clearly labeled', () => {
    const result = mergeDirectoryResults({
      users: [user({ id: 'owner-1', productType: 'ACADEMIA' })],
      receptionists: [receptionist({ id: 'staff-1' })],
      page: 1,
      pageSize: 50,
    });

    expect(result.items).toHaveLength(2);
    expect(result.items.find((i) => i.id === 'owner-1')?.kind).toBe(
      'ACADEMIA_OWNER',
    );
    expect(result.items.find((i) => i.id === 'staff-1')?.kind).toBe(
      'ACADEMIA_RECEPTIONIST',
    );
  });

  it('UT-003: an academia with no receptionist yet shows only the owner, no placeholder row', () => {
    const result = mergeDirectoryResults({
      users: [user({ id: 'owner-1', productType: 'ACADEMIA' })],
      receptionists: [],
      page: 1,
      pageSize: 50,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].kind).toBe('ACADEMIA_OWNER');
  });

  it('UT-004: no matches of either source returns a clean empty result, not an error', () => {
    const result = mergeDirectoryResults({
      users: [],
      receptionists: [],
      page: 1,
      pageSize: 50,
    });

    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it('UT-005: a large combined result set paginates correctly without truncating silently', () => {
    const users = Array.from({ length: 120 }, (_, i) =>
      user({ id: `u-${i}`, name: `Pessoa ${String(i).padStart(3, '0')}` }),
    );

    const page1 = mergeDirectoryResults({
      users,
      receptionists: [],
      page: 1,
      pageSize: 50,
    });
    const page3 = mergeDirectoryResults({
      users,
      receptionists: [],
      page: 3,
      pageSize: 50,
    });

    expect(page1.total).toBe(120);
    expect(page1.items).toHaveLength(50);
    expect(page3.items).toHaveLength(20);
  });

  it('UT-006: two different accounts sharing the exact same name are both returned, distinguishable by email', () => {
    const result = mergeDirectoryResults({
      users: [
        user({ id: 'a', name: 'Carlos Silva', email: 'carlos1@example.com' }),
        user({ id: 'b', name: 'Carlos Silva', email: 'carlos2@example.com' }),
      ],
      receptionists: [],
      page: 1,
      pageSize: 50,
    });

    expect(result.items).toHaveLength(2);
    const emails = result.items.map((i) => i.email);
    expect(emails).toEqual(
      expect.arrayContaining(['carlos1@example.com', 'carlos2@example.com']),
    );
  });

  it('never assigns a kind to a user row with no resolvable product', () => {
    const result = mergeDirectoryResults({
      users: [user({ id: 'orphan', productType: null })],
      receptionists: [],
      page: 1,
      pageSize: 50,
    });

    expect(result.items).toHaveLength(0);
  });
});
