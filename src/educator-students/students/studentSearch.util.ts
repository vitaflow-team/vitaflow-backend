// Lowercase, accent-free, trimmed form of a text, used for both sides of the
// student search so "joao" finds "João" and "ALVARES" finds "Álvares".
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Substring match on the folded name or e-mail. The term is plain text: `%`,
// `_`, quotes or markup match only themselves, never act as a pattern. A
// blank term matches everything.
export function matchesSearch(
  student: { name: string; email: string },
  search: string | undefined,
): boolean {
  const term = foldText(search ?? '');
  if (term === '') return true;

  return (
    foldText(student.name).includes(term) ||
    foldText(student.email).includes(term)
  );
}
