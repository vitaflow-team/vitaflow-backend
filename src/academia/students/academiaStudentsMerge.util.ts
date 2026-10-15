export interface AcademiaStudentRecord {
  id: string;
  name: string;
  email: string;
  professionalId: string | null;
  professionalName: string | null;
  userId: string | null;
}

export interface NextSessionSummary {
  startAt: Date;
  type: 'PRESENCIAL' | 'ONLINE';
}

export interface AcademiaStudentListItem {
  id: string;
  name: string;
  email: string;
  assignedEducator: { id: string; name: string } | null;
  nextSession: NextSessionSummary | null;
}

export interface AcademiaStudentsListResult {
  items: AcademiaStudentListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BuildAcademiaStudentsListInput {
  records: AcademiaStudentRecord[];
  nextSessionByClientId: Map<string, NextSessionSummary>;
  search?: string;
  horario?: 'COM' | 'SEM';
  page: number;
  pageSize: number;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function matchesAlunosSearch(
  record: AcademiaStudentRecord,
  search: string | undefined,
): boolean {
  if (!search) return true;
  const term = normalize(search);
  return (
    normalize(record.name).includes(term) ||
    (record.professionalName !== null &&
      normalize(record.professionalName).includes(term))
  );
}

export function buildAcademiaStudentsList({
  records,
  nextSessionByClientId,
  search,
  horario,
  page,
  pageSize,
}: BuildAcademiaStudentsListInput): AcademiaStudentsListResult {
  const withSession = records
    .filter((record) => matchesAlunosSearch(record, search))
    .map((record) => ({
      record,
      nextSession: record.professionalId
        ? (nextSessionByClientId.get(record.id) ?? null)
        : null,
    }));

  const byHorario = withSession.filter(({ nextSession }) => {
    if (horario === 'COM') return nextSession !== null;
    if (horario === 'SEM') return nextSession === null;
    return true;
  });

  byHorario.sort((a, b) =>
    a.record.name.localeCompare(b.record.name, 'pt-BR', {
      sensitivity: 'base',
    }),
  );

  const total = byHorario.length;
  const start = (page - 1) * pageSize;

  return {
    items: byHorario.slice(start, start + pageSize).map(toListItem),
    total,
    page,
    pageSize,
  };
}

function toListItem({
  record,
  nextSession,
}: {
  record: AcademiaStudentRecord;
  nextSession: NextSessionSummary | null;
}): AcademiaStudentListItem {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    assignedEducator: record.professionalId
      ? { id: record.professionalId, name: record.professionalName ?? '' }
      : null,
    nextSession,
  };
}

export interface AssignedStudentRecord {
  clientId: string;
  userId: string | null;
  professionalId: string;
}

export type NextForRecordsFn = (
  professionalId: string,
  records: Array<{ clientId: string; userId: string | null }>,
  now: Date,
) => Promise<Map<string, NextSessionSummary>>;

// ADR-003: nextForRecords is single-educator-scoped, so a page with mixed
// assigned educators is grouped by distinct professionalId and batched, one
// call per educator, merging the resulting maps.
export async function buildNextSessionMap(
  assignedStudents: AssignedStudentRecord[],
  now: Date,
  nextForRecords: NextForRecordsFn,
): Promise<Map<string, NextSessionSummary>> {
  const byEducator = new Map<
    string,
    Array<{ clientId: string; userId: string | null }>
  >();
  for (const student of assignedStudents) {
    const list = byEducator.get(student.professionalId) ?? [];
    list.push({ clientId: student.clientId, userId: student.userId });
    byEducator.set(student.professionalId, list);
  }

  const maps = await Promise.all(
    [...byEducator.entries()].map(([educatorId, records]) =>
      nextForRecords(educatorId, records, now),
    ),
  );

  const merged = new Map<string, NextSessionSummary>();
  for (const map of maps) {
    for (const [clientId, session] of map) {
      merged.set(clientId, session);
    }
  }
  return merged;
}
