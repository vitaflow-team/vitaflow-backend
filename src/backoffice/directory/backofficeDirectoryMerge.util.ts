export type DirectoryTypeFilter =
  | 'USER'
  | 'NUTRITIONIST'
  | 'PHYSICAL_EDUCATOR'
  | 'ACADEMIA';

export type DirectoryKind =
  | 'USER'
  | 'NUTRITIONIST'
  | 'PHYSICAL_EDUCATOR'
  | 'ACADEMIA_OWNER'
  | 'ACADEMIA_RECEPTIONIST';

export interface DirectoryResultItem {
  kind: DirectoryKind;
  id: string;
  name: string;
  email: string;
}

export interface DirectoryUserCandidate {
  id: string;
  name: string;
  email: string;
  productType: DirectoryTypeFilter | null;
}

export interface DirectoryReceptionistCandidate {
  id: string;
  name: string;
  email: string;
}

export interface MergeDirectoryInput {
  users: DirectoryUserCandidate[];
  receptionists: DirectoryReceptionistCandidate[];
  page: number;
  pageSize: number;
}

export interface DirectoryListResult {
  items: DirectoryResultItem[];
  total: number;
  page: number;
  pageSize: number;
}

const USER_KIND_BY_PRODUCT_TYPE: Record<DirectoryTypeFilter, DirectoryKind> = {
  USER: 'USER',
  NUTRITIONIST: 'NUTRITIONIST',
  PHYSICAL_EDUCATOR: 'PHYSICAL_EDUCATOR',
  ACADEMIA: 'ACADEMIA_OWNER',
};

// Both sources are already searched and type-filtered at the database level
// (platform-admin-access ADR-006) — this only discriminates, merges, sorts,
// and paginates the two already-matching result sets.
export function mergeDirectoryResults({
  users,
  receptionists,
  page,
  pageSize,
}: MergeDirectoryInput): DirectoryListResult {
  const userItems: DirectoryResultItem[] = users
    .filter(
      (
        user,
      ): user is DirectoryUserCandidate & {
        productType: DirectoryTypeFilter;
      } => user.productType !== null,
    )
    .map((user) => ({
      kind: USER_KIND_BY_PRODUCT_TYPE[user.productType],
      id: user.id,
      name: user.name,
      email: user.email,
    }));

  const receptionistItems: DirectoryResultItem[] = receptionists.map(
    (staff) => ({
      kind: 'ACADEMIA_RECEPTIONIST' as const,
      id: staff.id,
      name: staff.name,
      email: staff.email,
    }),
  );

  const merged = [...userItems, ...receptionistItems].sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR'),
  );

  const total = merged.length;
  const start = (page - 1) * pageSize;

  return {
    items: merged.slice(start, start + pageSize),
    total,
    page,
    pageSize,
  };
}
