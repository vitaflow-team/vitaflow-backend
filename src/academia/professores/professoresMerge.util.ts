export interface ActiveEmployeeCandidate {
  id: string;
  educatorId: string;
  name: string;
  email: string;
  startedAt: Date;
}

export interface PendingInvitationCandidate {
  id: string;
  educatorId: string | null;
  matchedName: string | null;
  email: string;
}

export interface ProfessorListItem {
  id: string;
  name: string | null;
  email: string;
  status: 'ACTIVE' | 'PENDING';
  startedAt: string | null;
  academiaStudentCount: number;
}

export interface ProfessoresListResult {
  items: ProfessorListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MergeProfessoresInput {
  active: ActiveEmployeeCandidate[];
  pending: PendingInvitationCandidate[];
  studentCounts: Map<string, number>;
  search?: string;
  page: number;
  pageSize: number;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function matchesSearch(
  search: string | undefined,
  ...fields: string[]
): boolean {
  if (!search) return true;
  const term = normalize(search);
  return fields.some((field) => normalize(field).includes(term));
}

export function mergeProfessoresList({
  active,
  pending,
  studentCounts,
  search,
  page,
  pageSize,
}: MergeProfessoresInput): ProfessoresListResult {
  const activeItems: ProfessorListItem[] = active
    .filter((employment) =>
      matchesSearch(search, employment.name, employment.email),
    )
    .map((employment) => ({
      id: employment.id,
      name: employment.name,
      email: employment.email,
      status: 'ACTIVE' as const,
      startedAt: employment.startedAt.toISOString(),
      academiaStudentCount: studentCounts.get(employment.educatorId) ?? 0,
    }));

  const pendingItems: ProfessorListItem[] = pending
    .filter((invitation) => matchesSearch(search, invitation.email))
    .map((invitation) => ({
      id: invitation.id,
      name: invitation.matchedName,
      email: invitation.email,
      status: 'PENDING' as const,
      startedAt: null,
      academiaStudentCount: 0,
    }));

  const merged = [...activeItems, ...pendingItems].sort((a, b) =>
    (a.name ?? a.email).localeCompare(b.name ?? b.email, 'pt-BR'),
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
